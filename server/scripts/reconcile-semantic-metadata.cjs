const fs = require('node:fs');
const path = require('node:path');
const { assertStagingTarget, upsertSource, removeSource } = require('./semantic-index-staging.cjs');
const { embedLocal } = require('./semantic-metadata-pilot.cjs');
const { semanticMetadataText, semanticDepartmentKey, semanticMetadataChecksum } = require('../src/modules/search/semantic-checksum.ts');

const MODEL = 'bge-m3:latest';
const MODEL_TAGS_URL = 'http://127.0.0.1:11434/api/tags';
const SOURCE_LIMIT = 10000;

function parseArgs(argv) {
  const result = { maxChanges: 20, apply: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--apply' || arg === '--dry-run') {
      if (result.mode) throw new Error('Wybierz tylko --apply albo --dry-run.');
      result.mode = arg;
      result.apply = arg === '--apply';
      continue;
    }
    if (!['--tenant', '--max-changes', '--staging-db', '--staging-data-dir'].includes(arg) || !argv[index + 1]) {
      throw new Error(`Nieznany lub niepelny argument: ${arg}`);
    }
    const value = argv[++index];
    if (arg === '--tenant') result.tenantCode = value;
    if (arg === '--max-changes') result.maxChanges = Number(value);
    if (arg === '--staging-db') result.stagingDb = value;
    if (arg === '--staging-data-dir') result.stagingDataDir = value;
  }
  if (!result.mode || !result.tenantCode || !/^[a-z0-9_-]{2,30}$/i.test(result.tenantCode)
    || !result.stagingDb || !result.stagingDataDir
    || !Number.isSafeInteger(result.maxChanges) || result.maxChanges < 1 || result.maxChanges > 100) {
    throw new Error('Uzycie: --tenant KOD --max-changes 1..100 --staging-db NAZWA --staging-data-dir SCIEZKA --dry-run|--apply');
  }
  return result;
}

function validateProductionUrl(databaseUrl) {
  if (!databaseUrl) throw new Error('Brak produkcyjnego DATABASE_URL.');
  const url = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['localhost', '127.0.0.1'].includes(url.hostname.toLowerCase())
    || (url.port || '5432') !== '5432'
    || decodeURIComponent(url.pathname.slice(1)) !== 'archivecore') {
    throw new Error('DATABASE_URL musi wskazywac lokalna produkcyjna baze archivecore na porcie 5432.');
  }
}

function makeSource(tenantId, sourceType, sourceId, department, text) {
  const source = { tenantId, sourceType, sourceId, department: department?.trim() || null, text };
  return { ...source, checksum: semanticMetadataChecksum(source) };
}

async function readModelVersion(fetcher = fetch) {
  const response = await fetcher(MODEL_TAGS_URL, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Lokalny model nie odpowiada (HTTP ${response.status}).`);
  const tags = await response.json();
  const digest = tags.models?.find((model) => model.name === MODEL)?.digest;
  if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/i.test(digest)) {
    throw new Error('Nie znaleziono stabilnego identyfikatora lokalnego modelu bge-m3.');
  }
  return `bge-m3@${digest.toLowerCase()}`;
}

async function loadTenantSources(production, tenantCode) {
  return production.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const [target] = await tx.$queryRawUnsafe('SELECT current_database() AS "database"');
    if (target.database !== 'archivecore') throw new Error('Nie polaczono z produkcyjna baza archivecore.');
    const tenant = await tx.tenant.findFirst({
      where: { shortCode: { equals: tenantCode, mode: 'insensitive' } },
      select: { id: true, shortCode: true },
    });
    if (!tenant) throw new Error('Nie znaleziono tenanta.');
    const folderWhere = {
      tenantId: tenant.id,
      status: { not: 'disposed' },
      OR: [
        { boxId: null },
        { box: { is: { tenantId: tenant.id, deletedAt: null, status: { notIn: ['disposed', 'lost'] } } } },
      ],
    };
    const [folderCount, listCount] = await Promise.all([
      tx.folder.count({ where: folderWhere }),
      tx.transferList.count({ where: { tenantId: tenant.id } }),
    ]);
    if (folderCount + listCount > SOURCE_LIMIT) {
      throw new Error('Tenant przekracza limit pilota 10000 metadanych; podziel indeksowanie na strony.');
    }
    const [folders, lists] = await Promise.all([
      tx.folder.findMany({
        where: folderWhere,
        select: { id: true, title: true, description: true, docType: true, box: { select: { department: true } } },
        orderBy: { id: 'asc' },
      }),
      tx.transferList.findMany({
        where: { tenantId: tenant.id },
        select: { id: true, title: true, notes: true },
        orderBy: { id: 'asc' },
      }),
    ]);
    const sources = [
      ...folders.map((folder) => makeSource(tenant.id, 'folder', folder.id, folder.box?.department ?? null,
        semanticMetadataText(folder.title, folder.description, folder.docType))),
      ...lists.map((list) => makeSource(tenant.id, 'transfer_list', list.id, null,
        semanticMetadataText(list.title, list.notes))),
    ];
    return { tenant, sources };
  }, { timeout: 30000 });
}

async function loadIndexedSources(staging, tenantId) {
  return staging.$queryRawUnsafe(`SELECT source_type AS "sourceType", source_id AS "sourceId",
    source_checksum AS "checksum", department_key AS "departmentKey", model_version AS "modelVersion"
    FROM semantic_metadata_index WHERE tenant_id = $1::uuid`, tenantId);
}

function planChanges(sources, indexed, modelVersion, maxChanges) {
  const sourceByKey = new Map(sources.map((source) => [`${source.sourceType}:${source.sourceId}`, source]));
  const indexByKey = new Map(indexed.map((row) => [`${row.sourceType}:${row.sourceId}`, row]));
  const stale = indexed.filter((row) => !sourceByKey.has(`${row.sourceType}:${row.sourceId}`));
  const changed = sources.filter((source) => {
    const row = indexByKey.get(`${source.sourceType}:${source.sourceId}`);
    return !row || row.checksum !== source.checksum
      || row.departmentKey !== semanticDepartmentKey(source.department) || row.modelVersion !== modelVersion;
  });
  return {
    stale, changed,
    removals: stale.slice(0, maxChanges),
    updates: changed.slice(0, Math.max(0, maxChanges - stale.length)),
  };
}

async function runReconciliation(production, staging, options, dependencies = {}) {
  validateProductionUrl(options.productionUrl);
  await assertStagingTarget(staging, options.stagingUrl, options.stagingDb, options.stagingDataDir);
  const modelVersion = await (dependencies.readModelVersion || readModelVersion)();
  const { tenant, sources } = await loadTenantSources(production, options.tenantCode);
  const indexed = await loadIndexedSources(staging, tenant.id);
  const plan = planChanges(sources, indexed, modelVersion, options.maxChanges);
  if (options.apply) {
    for (const row of plan.removals) {
      await removeSource(staging, tenant.id, row.sourceType, row.sourceId);
    }
    for (let index = 0; index < plan.updates.length; index += 8) {
      const batch = plan.updates.slice(index, index + 8);
      const vectors = await (dependencies.embedLocal || embedLocal)(batch.map((source) => source.text));
      if (vectors.length !== batch.length) throw new Error('Lokalny model zwrocil niepelna partie wektorow.');
      for (let item = 0; item < batch.length; item++) {
        const source = batch[item];
        await upsertSource(staging, { ...source, modelVersion, embedding: vectors[item] });
      }
    }
    const versionAfter = await (dependencies.readModelVersion || readModelVersion)();
    if (versionAfter !== modelVersion) throw new Error('Model zmienil sie podczas indeksowania; uruchom ponownie.');
  }
  return {
    tenant: tenant.shortCode, sourceCount: sources.length, indexedCount: indexed.length,
    changedCount: plan.changed.length, staleCount: plan.stale.length,
    updatedCount: options.apply ? plan.updates.length : 0,
    removedCount: options.apply ? plan.removals.length : 0,
    remainingCount: plan.changed.length + plan.stale.length
      - (options.apply ? plan.updates.length + plan.removals.length : 0),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
  validateProductionUrl(process.env.DATABASE_URL);
  if (!process.env.STAGING_DATABASE_URL) throw new Error('Brak STAGING_DATABASE_URL; nie uzywaj produkcyjnego URL jako testowego.');
  const { PrismaClient } = require('@prisma/client');
  const production = new PrismaClient();
  const staging = new PrismaClient({ datasources: { db: { url: process.env.STAGING_DATABASE_URL } } });
  const lockPath = path.win32.join(path.win32.dirname(options.stagingDataDir), 'semantic-reconcile.lock');
  let lock;
  try {
    await assertStagingTarget(staging, process.env.STAGING_DATABASE_URL, options.stagingDb, options.stagingDataDir);
    lock = fs.openSync(lockPath, 'wx');
    const result = await runReconciliation(production, staging, {
      ...options, productionUrl: process.env.DATABASE_URL, stagingUrl: process.env.STAGING_DATABASE_URL,
    });
    console.log(`Tenant ${result.tenant}: zrodla ${result.sourceCount}, w indeksie ${result.indexedCount}, zmienione ${result.changedCount}, nieaktualne ${result.staleCount}.`);
    console.log(options.apply
      ? `Zaktualizowano ${result.updatedCount}, usunieto ${result.removedCount}, pozostalo ${result.remainingCount}.`
      : 'Podglad: nie wyslano tekstu do modelu i nie zmieniono baz.');
  } finally {
    if (lock !== undefined) {
      fs.closeSync(lock);
      fs.unlinkSync(lockPath);
    }
    await Promise.all([production.$disconnect(), staging.$disconnect()]);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Odswiezanie testowego indeksu:', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs, validateProductionUrl, sourceChecksum: semanticMetadataChecksum, readModelVersion,
  loadTenantSources, loadIndexedSources, planChanges, runReconciliation,
};
