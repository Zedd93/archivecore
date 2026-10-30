const path = require('node:path');

const MODEL = 'bge-m3:latest';
const EMBED_URL = 'http://127.0.0.1:11434/api/embed';

function parseArgs(argv) {
  const options = { max: 100, top: 10, dryRun: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (!['--tenant', '--query', '--department', '--max', '--top'].includes(arg) || !argv[index + 1]) {
      throw new Error(`Nieznany lub niepelny argument: ${arg}`);
    }
    const value = argv[++index];
    if (arg === '--tenant') options.tenantCode = value.trim();
    if (arg === '--query') options.query = value.trim();
    if (arg === '--department') options.department = value.trim();
    if (arg === '--max') options.max = Number(value);
    if (arg === '--top') options.top = Number(value);
  }
  if (!options.tenantCode || !/^[a-z0-9_-]{2,30}$/i.test(options.tenantCode)) {
    throw new Error('Podaj poprawny --tenant KOD.');
  }
  if (!options.dryRun && (!options.query || options.query.length < 3 || options.query.length > 300)) {
    throw new Error('Podaj --query o dlugosci od 3 do 300 znakow.');
  }
  if (!Number.isSafeInteger(options.max) || options.max < 1 || options.max > 200) {
    throw new Error('--max musi byc liczba od 1 do 200.');
  }
  if (!Number.isSafeInteger(options.top) || options.top < 1 || options.top > 20) {
    throw new Error('--top musi byc liczba od 1 do 20.');
  }
  if (options.department === '') throw new Error('--department nie moze byc pusty.');
  return options;
}

function recordText(...parts) {
  return parts.filter(Boolean).join(' | ').slice(0, 1500);
}

async function loadMetadata(db, { tenantCode, department, max }) {
  const tenant = await db.tenant.findFirst({
    where: { shortCode: { equals: tenantCode, mode: 'insensitive' } },
    select: { id: true, shortCode: true },
  });
  if (!tenant) throw new Error('Nie znaleziono tenanta.');

  const folders = await db.folder.findMany({
    where: {
      tenantId: tenant.id,
      status: { not: 'disposed' },
      ...(department
        ? { box: { is: { deletedAt: null, department: { equals: department, mode: 'insensitive' } } } }
        : { OR: [{ boxId: null }, { box: { is: { deletedAt: null } } }] }),
    },
    select: {
      id: true, folderNumber: true, title: true, description: true, docType: true,
      transferListItem: { select: { folderTitle: true, categoryCode: true,
        transferList: { select: { listNumber: true, title: true } } } },
    },
    orderBy: { id: 'asc' },
    take: max,
  });

  const records = folders.map((folder) => ({
    type: 'folder', id: folder.id, label: `${folder.folderNumber} - ${folder.title}`,
    text: recordText(folder.title, folder.description, folder.docType,
      folder.transferListItem?.folderTitle, folder.transferListItem?.categoryCode,
      folder.transferListItem?.transferList?.title),
  }));

  // A list spans departments. With a department filter, expose it only through its visible folders.
  if (!department && records.length < max) {
    const lists = await db.transferList.findMany({
      where: { tenantId: tenant.id },
      select: { id: true, listNumber: true, title: true, transferringUnit: true, notes: true },
      orderBy: { id: 'asc' },
      take: max - records.length,
    });
    records.push(...lists.map((list) => ({
      type: 'transfer_list', id: list.id, label: `${list.listNumber} - ${list.title}`,
      text: recordText(list.title, list.transferringUnit, list.notes),
    })));
  }
  return { tenant: tenant.shortCode, records };
}

async function embedLocal(texts, fetcher = fetch) {
  const response = await fetcher(EMBED_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, input: texts }),
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) throw new Error(`Lokalny model nie odpowiedzial poprawnie (HTTP ${response.status}).`);
  const data = await response.json();
  if (!Array.isArray(data.embeddings) || data.embeddings.length !== texts.length
    || data.embeddings.some((vector) => !Array.isArray(vector) || vector.length !== 1024
      || vector.some((value) => !Number.isFinite(value)))) {
    throw new Error('Lokalny model zwrocil niepoprawne wektory.');
  }
  return data.embeddings;
}

function cosine(left, right) {
  let dot = 0, leftNorm = 0, rightNorm = 0;
  for (let index = 0; index < left.length; index++) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
}

async function runPilot(db, options, embed = embedLocal) {
  const { tenant, records } = await loadMetadata(db, options);
  if (options.dryRun) return { tenant, records: records.length, results: [] };
  if (records.length === 0) return { tenant, records: 0, results: [] };
  const [queryVector] = await embed([options.query]);
  const scores = [];
  for (let start = 0; start < records.length; start += 8) {
    const batch = records.slice(start, start + 8);
    const vectors = await embed(batch.map((record) => record.text));
    if (vectors.length !== batch.length || vectors.some((vector) => vector.length !== queryVector.length)) {
      throw new Error('Niezgodne wymiary wektorow.');
    }
    scores.push(...batch.map((record, index) => ({
      type: record.type, id: record.id, label: record.label,
      score: cosine(queryVector, vectors[index]),
    })));
  }
  scores.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return { tenant, records: records.length, results: scores.slice(0, options.top) };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient();
  try {
    const result = await runPilot(db, options);
    console.log(`Pilot lokalny: tenant ${result.tenant}, probka ${result.records} rekordow (tylko odczyt).`);
    if (options.dryRun) console.log('Podglad: nie uruchomiono modelu ani nie zmieniono danych.');
    else console.table(result.results.map((row) => ({
      typ: row.type, zgodnosc: row.score.toFixed(3), nazwa: row.label, id: row.id,
    })));
  } finally {
    await db.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Pilot wyszukiwania nie powiodl sie:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, loadMetadata, embedLocal, cosine, runPilot, EMBED_URL, MODEL };
