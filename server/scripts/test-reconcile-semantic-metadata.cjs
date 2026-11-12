const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseArgs, validateProductionUrl, sourceChecksum, readModelVersion,
  loadTenantSources, planChanges, runReconciliation,
} = require('./reconcile-semantic-metadata.cjs');

const TENANT = '11111111-1111-4111-8111-111111111111';
const FOLDER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const LIST = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';

test('arguments require explicit dry-run or apply and bounded work', () => {
  const base = ['--tenant', 'SMPOLI', '--staging-db', 'archivecore_staging', '--staging-data-dir', 'C:\\Apps\\PostgreSQL-Staging\\data'];
  assert.equal(parseArgs([...base, '--dry-run']).apply, false);
  assert.equal(parseArgs([...base, '--max-changes', '10', '--apply']).maxChanges, 10);
  assert.throws(() => parseArgs(base), /Uzycie/);
  assert.throws(() => parseArgs([...base, '--max-changes', '101', '--apply']), /Uzycie/);
  assert.throws(() => parseArgs([...base, '--dry-run', '--apply']), /Wybierz/);
});

test('production URL must be the local production cluster', () => {
  assert.doesNotThrow(() => validateProductionUrl('postgresql://u:p@localhost:5432/archivecore'));
  assert.throws(() => validateProductionUrl('postgresql://u:p@localhost:55433/archivecore_staging'), /produkcyjna/);
  assert.throws(() => validateProductionUrl('postgresql://u:p@remote:5432/archivecore'), /produkcyjna/);
});

test('checksum changes with content or department', () => {
  const base = { sourceType: 'folder', text: 'Faktury', department: 'Księgowość' };
  assert.equal(sourceChecksum(base), sourceChecksum({ ...base, department: ' księgowość ' }));
  assert.notEqual(sourceChecksum(base), sourceChecksum({ ...base, text: 'Umowy' }));
  assert.notEqual(sourceChecksum(base), sourceChecksum({ ...base, department: 'Kadry' }));
});

test('model digest is pinned to the local bge-m3 artifact', async () => {
  const digest = 'a'.repeat(64);
  const version = await readModelVersion(async (url) => {
    assert.equal(url, 'http://127.0.0.1:11434/api/tags');
    return { ok: true, json: async () => ({ models: [{ name: 'bge-m3:latest', digest }] }) };
  });
  assert.equal(version, `bge-m3@${digest}`);
});

test('source loading uses a read-only transaction and excludes HR and scans', async () => {
  const calls = [];
  const tx = {
    $executeRawUnsafe: async (sql) => { calls.push(sql); },
    $queryRawUnsafe: async () => [{ database: 'archivecore' }],
    tenant: { findFirst: async () => ({ id: TENANT, shortCode: 'SMPOLI' }) },
    folder: {
      count: async ({ where }) => { assert.equal(where.tenantId, TENANT); return 1; },
      findMany: async ({ select }) => {
        assert.equal(select.box.select.department, true);
        return [{ id: FOLDER, title: 'Faktury', description: 'Rok 2025', docType: 'finanse', box: { department: 'Księgowość' } }];
      },
    },
    transferList: {
      count: async () => 1,
      findMany: async () => [{ id: LIST, title: 'Spis ZO', notes: null }],
    },
  };
  const db = { $transaction: async (fn) => fn(tx) };
  const result = await loadTenantSources(db, 'SMPOLI');
  assert.equal(calls[0], 'SET TRANSACTION READ ONLY');
  assert.deepEqual(result.sources.map((row) => row.sourceType), ['folder', 'transfer_list']);
  assert.equal(result.sources[0].department, 'Księgowość');
  assert.equal(result.sources[1].department, null);
  assert.equal(JSON.stringify(result.sources).includes('ocrText'), false);
});

test('planner is idempotent and prioritizes stale removals', () => {
  const source = { sourceType: 'folder', sourceId: FOLDER, checksum: 'a'.repeat(64), department: 'Księgowość' };
  const row = { sourceType: 'folder', sourceId: FOLDER, checksum: source.checksum, departmentKey: 'księgowość', modelVersion: 'model-1' };
  assert.deepEqual(planChanges([source], [row], 'model-1', 10).changed, []);
  const changed = planChanges([{ ...source, checksum: 'b'.repeat(64) }], [row], 'model-1', 10);
  assert.equal(changed.updates.length, 1);
  const stale = { sourceType: 'transfer_list', sourceId: LIST, checksum: 'c'.repeat(64), departmentKey: null, modelVersion: 'model-1' };
  const limited = planChanges([source], [row, stale], 'model-1', 1);
  assert.deepEqual(limited.removals, [stale]);
  assert.deepEqual(limited.updates, []);
  assert.equal(planChanges([source], [row], 'model-2', 1).updates.length, 1);
});

function reconciliationDatabases() {
  const productionCalls = [];
  const stagingWrites = [];
  const tx = {
    $executeRawUnsafe: async (sql) => { productionCalls.push(sql); },
    $queryRawUnsafe: async () => [{ database: 'archivecore' }],
    tenant: { findFirst: async () => ({ id: TENANT, shortCode: 'SMPOLI' }) },
    folder: {
      count: async () => 1,
      findMany: async () => [{ id: FOLDER, title: 'Faktury', description: null, docType: null, box: { department: 'Księgowość' } }],
    },
    transferList: { count: async () => 0, findMany: async () => [] },
  };
  const production = { $transaction: async (fn) => fn(tx) };
  let stagingReads = 0;
  const staging = {
    $queryRawUnsafe: async () => ++stagingReads === 1
      ? [{ database: 'archivecore_staging', dataDirectory: 'C:\\Apps\\PostgreSQL-Staging\\data' }]
      : [],
    $executeRawUnsafe: async (...args) => { stagingWrites.push(args); return 1; },
  };
  return { production, staging, productionCalls, stagingWrites };
}

const options = {
  tenantCode: 'SMPOLI', maxChanges: 1, apply: false,
  productionUrl: 'postgresql://u:p@localhost:5432/archivecore',
  stagingUrl: 'postgresql://u:p@localhost:55433/archivecore_staging',
  stagingDb: 'archivecore_staging', stagingDataDir: 'C:\\Apps\\PostgreSQL-Staging\\data',
};

test('preview reads production in a read-only transaction without embedding or writes', async () => {
  const db = reconciliationDatabases();
  const result = await runReconciliation(db.production, db.staging, options, {
    readModelVersion: async () => 'bge-m3@' + 'a'.repeat(64),
    embedLocal: async () => { throw new Error('preview must not embed'); },
  });
  assert.equal(result.changedCount, 1);
  assert.equal(result.updatedCount, 0);
  assert.deepEqual(db.productionCalls, ['SET TRANSACTION READ ONLY']);
  assert.deepEqual(db.stagingWrites, []);
});

test('apply writes only to staging and respects the change limit', async () => {
  const db = reconciliationDatabases();
  const result = await runReconciliation(db.production, db.staging, { ...options, apply: true }, {
    readModelVersion: async () => 'bge-m3@' + 'a'.repeat(64),
    embedLocal: async (texts) => {
      assert.deepEqual(texts, ['Faktury']);
      return [[1, ...Array(1023).fill(0)]];
    },
  });
  assert.equal(result.updatedCount, 1);
  assert.equal(result.remainingCount, 0);
  assert.deepEqual(db.productionCalls, ['SET TRANSACTION READ ONLY']);
  assert.equal(db.stagingWrites.length, 1);
  assert.match(db.stagingWrites[0][0], /INSERT INTO semantic_metadata_index/);
});
