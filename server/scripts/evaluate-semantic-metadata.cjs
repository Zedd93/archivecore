const fs = require('node:fs/promises');
const path = require('node:path');
const { parseArgs, loadMetadata, embedLocal, cosine } = require('./semantic-metadata-pilot.cjs');

function parseEvaluationArgs(argv) {
  let file;
  const relevant = [];
  const pilotArgs = ['--dry-run'];
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--file') {
      if (file || !argv[index + 1]) throw new Error('Podaj jeden --file z przypadkami testowymi.');
      file = argv[++index];
    } else if (argv[index] === '--relevant') {
      if (!argv[index + 1]) throw new Error('Podaj --relevant type:UUID.');
      relevant.push(argv[++index]);
    } else {
      pilotArgs.push(argv[index]);
    }
  }
  const options = parseArgs(pilotArgs);
  if (file) {
    if (options.query || relevant.length) throw new Error('Uzyj --file albo --query i --relevant, nie obu trybow.');
    return { ...options, file };
  }
  if (!options.query || !relevant.length) {
    throw new Error('Podaj --file albo --query oraz co najmniej jeden --relevant type:UUID.');
  }
  const cases = parseCases(JSON.stringify([{
    query: options.query,
    relevant: relevant.map((value) => {
      const [type, id, extra] = value.split(':');
      if (extra || !type || !id) throw new Error('Podaj --relevant type:UUID.');
      return { type, id };
    }),
  }]));
  return { ...options, cases };
}

function parseCases(input) {
  const cases = JSON.parse(input);
  if (!Array.isArray(cases) || cases.length < 1 || cases.length > 20) {
    throw new Error('Plik musi zawierac od 1 do 20 zapytan.');
  }
  for (const item of cases) {
    if (!item || typeof item.query !== 'string' || item.query.trim().length < 3 || item.query.length > 300
      || !Array.isArray(item.relevant) || item.relevant.length < 1 || item.relevant.length > 20) {
      throw new Error('Kazdy przypadek wymaga query i od 1 do 20 oczekiwanych rekordow.');
    }
    const keys = new Set();
    for (const record of item.relevant) {
      if (!record || !['folder', 'transfer_list'].includes(record.type)
        || typeof record.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(record.id)) {
        throw new Error('Oczekiwany rekord wymaga type oraz UUID id.');
      }
      const key = `${record.type}:${record.id.toLowerCase()}`;
      if (keys.has(key)) throw new Error('Oczekiwany rekord jest zduplikowany.');
      keys.add(key);
    }
  }
  return cases;
}

async function evaluateCases(db, options, cases, embed = embedLocal) {
  const { tenant, records } = await loadMetadata(db, options);
  const available = new Set(records.map((record) => `${record.type}:${record.id.toLowerCase()}`));
  for (const item of cases) {
    for (const record of item.relevant) {
      if (!available.has(`${record.type}:${record.id.toLowerCase()}`)) {
        throw new Error(`Oczekiwany rekord ${record.type}:${record.id} nie jest w probce tenanta ${tenant}. Zwieksz --max lub sprawdz dostep.`);
      }
    }
  }

  const vectors = [];
  for (let start = 0; start < records.length; start += 8) {
    const batch = records.slice(start, start + 8);
    const embedded = await embed(batch.map((record) => record.text));
    if (embedded.length !== batch.length || embedded.some((vector) => vector.length !== 1024)) {
      throw new Error('Niezgodne wymiary wektorow dokumentow.');
    }
    vectors.push(...embedded);
  }

  const queryVectors = await embed(cases.map((item) => item.query));
  if (queryVectors.length !== cases.length || queryVectors.some((vector) => vector.length !== 1024)) {
    throw new Error('Niezgodne wymiary wektorow zapytan.');
  }

  const results = cases.map((item, index) => {
    const relevant = new Set(item.relevant.map((record) => `${record.type}:${record.id.toLowerCase()}`));
    const ranked = records.map((record, position) => ({
      type: record.type, id: record.id, label: record.label,
      score: cosine(queryVectors[index], vectors[position]),
    })).sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
    const top = ranked.slice(0, options.top);
    const firstRelevant = top.findIndex((record) => relevant.has(`${record.type}:${record.id.toLowerCase()}`));
    const hits = top.filter((record) => relevant.has(`${record.type}:${record.id.toLowerCase()}`)).length;
    return {
      query: item.query, hits, expected: relevant.size,
      recall: hits / relevant.size,
      reciprocalRank: firstRelevant < 0 ? 0 : 1 / (firstRelevant + 1),
      top,
    };
  });
  const summary = {
    tenant, sample: records.length, queries: cases.length, top: options.top,
    hitRate: results.filter((result) => result.hits > 0).length / results.length,
    meanRecall: results.reduce((sum, result) => sum + result.recall, 0) / results.length,
    mrr: results.reduce((sum, result) => sum + result.reciprocalRank, 0) / results.length,
  };
  return { summary, results };
}

async function main() {
  const options = parseEvaluationArgs(process.argv.slice(2));
  const cases = options.cases ?? parseCases(await fs.readFile(options.file, 'utf8'));
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient();
  try {
    const { summary, results } = await evaluateCases(db, options, cases);
    console.log(`Pilot: tenant ${summary.tenant}, probka ${summary.sample}, zapytania ${summary.queries}, top ${summary.top}.`);
    console.table(results.map((result) => ({
      zapytanie: result.query, trafienia: `${result.hits}/${result.expected}`,
      recall: result.recall.toFixed(3), RR: result.reciprocalRank.toFixed(3),
      pierwszyWynik: result.top[0]?.label ?? '-',
    })));
    console.log(`Hit-rate@${summary.top}: ${summary.hitRate.toFixed(3)}, sredni recall@${summary.top}: ${summary.meanRecall.toFixed(3)}, MRR@${summary.top}: ${summary.mrr.toFixed(3)}.`);
    console.log('Tylko odczyt. Wyniki nie sa udostepniane w aplikacji.');
  } finally {
    await db.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Ocena pilota nie powiodla sie:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { parseEvaluationArgs, parseCases, evaluateCases };
