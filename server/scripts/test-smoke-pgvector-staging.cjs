const assert = require('node:assert/strict');
const test = require('node:test');
const { validateTarget, validateDataDirectory, smoke } = require('./smoke-pgvector-staging.cjs');

const STAGING_DATA_DIRECTORY = 'C:\\PostgreSQL-Staging\\16\\data';

test('refuses production database and port 5432 regardless of host', () => {
  assert.throws(() => validateTarget('postgresql://u:p@localhost:5432/archivecore', 'archivecore', 'archivecore'), /test/);
  assert.throws(() => validateTarget('postgresql://u:p@localhost:5432/archivecore_staging', 'archivecore_staging', 'archivecore_staging'), /5432/);
  assert.throws(() => validateTarget('postgresql://u:p@db.example:5432/archivecore_staging', 'archivecore_staging', 'archivecore_staging'), /5432/);
  assert.throws(() => validateTarget('postgresql://u:p@db.example/archivecore_staging', 'archivecore_staging', 'archivecore_staging'), /5432/);
  assert.throws(() => validateTarget('postgresql://u:p@localhost:5433/archivecore', 'archivecore_staging', 'archivecore'), /zgodne/);
  assert.doesNotThrow(() => validateTarget('postgresql://u:p@localhost:5433/archivecore_staging', 'archivecore_staging', 'archivecore_staging'));
});

test('requires the actual staging cluster data directory', () => {
  assert.throws(() => validateDataDirectory('C:\\Program Files\\PostgreSQL\\16\\data', STAGING_DATA_DIRECTORY), /produkcyjnym/);
  assert.throws(() => validateDataDirectory('C:\\OtherCluster\\data', STAGING_DATA_DIRECTORY), /nie zgadza sie/);
  assert.throws(() => validateDataDirectory('data', STAGING_DATA_DIRECTORY), /bezwzgledna/);
  assert.doesNotThrow(() => validateDataDirectory('c:\\postgresql-staging\\16\\data\\', STAGING_DATA_DIRECTORY));
});

test('smoke test rolls back synthetic vectors and preserves extension state', async () => {
  const calls = [];
  let query = 0;
  const db = {
    $queryRawUnsafe: async () => query++ === 0
      ? [{ database: 'archivecore_staging', dataDirectory: STAGING_DATA_DIRECTORY, available: true, enabled: false }]
      : [{ enabled: false }],
    $transaction: async (callback) => callback({
      $executeRawUnsafe: async (sql) => { calls.push(sql); },
      $queryRawUnsafe: async (sql) => sql.includes('WHERE tenant')
        ? [{ id: 'blisko' }, { id: 'daleko' }]
        : [{ id: 'blisko' }],
    }),
  };
  const result = await smoke(db, 'postgresql://u:p@localhost:5433/archivecore_staging', 'archivecore_staging', STAGING_DATA_DIRECTORY);
  assert.deepEqual(result, { database: 'archivecore_staging', extensionWasEnabled: false });
  assert.equal(calls.length, 4);
  assert.equal(query, 2);
});

test('smoke test rejects a result from another tenant or department', async () => {
  const db = {
    $queryRawUnsafe: async () => [{
      database: 'archivecore_staging', dataDirectory: STAGING_DATA_DIRECTORY,
      available: true, enabled: false,
    }],
    $transaction: async (callback) => callback({
      $executeRawUnsafe: async () => {},
      $queryRawUnsafe: async (sql) => sql.includes('WHERE tenant')
        ? [{ id: 'inny-tenant' }]
        : [{ id: 'blisko' }],
    }),
  };
  await assert.rejects(
    smoke(db, 'postgresql://u:p@localhost:5433/archivecore_staging', 'archivecore_staging', STAGING_DATA_DIRECTORY),
    /ujawnil obcy rekord/
  );
});

test('missing binary fails before any transaction', async () => {
  const db = {
    $queryRawUnsafe: async () => [{ database: 'archivecore_staging', dataDirectory: STAGING_DATA_DIRECTORY, available: false, enabled: false }],
    $transaction: async () => { throw new Error('unexpected transaction'); },
  };
  await assert.rejects(smoke(db, 'postgresql://u:p@localhost:5433/archivecore_staging', 'archivecore_staging', STAGING_DATA_DIRECTORY), /nie jest zainstalowany/);
});

test('production target is rejected before querying the database', async () => {
  const db = { $queryRawUnsafe: async () => { throw new Error('unexpected database query'); } };
  await assert.rejects(smoke(db, 'postgresql://u:p@localhost:5432/archivecore', 'archivecore', STAGING_DATA_DIRECTORY), /test/);
});

test('production cluster is rejected before creating the extension', async () => {
  const db = {
    $queryRawUnsafe: async () => [{
      database: 'archivecore_staging',
      dataDirectory: 'C:\\Program Files\\PostgreSQL\\16\\data',
      available: true,
      enabled: false,
    }],
    $transaction: async () => { throw new Error('unexpected transaction'); },
  };
  await assert.rejects(smoke(db, 'postgresql://u:p@localhost:5433/archivecore_staging', 'archivecore_staging', STAGING_DATA_DIRECTORY), /produkcyjnym/);
});
