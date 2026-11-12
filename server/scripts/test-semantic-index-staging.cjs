const test = require('node:test');
const assert = require('node:assert/strict');
const {
  departmentKey, vectorLiteral, validateSource, assertStagingTarget,
  initSchema, upsertSource, removeSource, searchIndex,
} = require('./semantic-index-staging.cjs');

const TENANT = '11111111-1111-4111-8111-111111111111';
const SOURCE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const VECTOR = [1, ...Array(1023).fill(0)];
const URL = 'postgresql://u:p@127.0.0.1:55433/archivecore_staging';
const DATA = 'C:\\Apps\\PostgreSQL-Staging\\data';

test('staging target rejects production before any write', async () => {
  const db = { $queryRawUnsafe: async () => [{ database: 'archivecore_staging', dataDirectory: 'C:\\Program Files\\PostgreSQL\\16\\data' }] };
  await assert.rejects(assertStagingTarget(db, URL, 'archivecore_staging', DATA), /produkcyjnym/);
  await assert.rejects(assertStagingTarget(db, 'postgresql://u:p@localhost:5432/archivecore_staging', 'archivecore_staging', DATA), /5432/);
});

test('staging schema contains tenant key, source key and 1024-dimensional index', async () => {
  const statements = [];
  await initSchema({ $executeRawUnsafe: async (sql) => { statements.push(sql); } });
  assert.equal(statements.length, 4);
  assert.match(statements[1], /PRIMARY KEY \(tenant_id, source_type, source_id\)/);
  assert.match(statements[1], /embedding vector\(1024\)/);
  assert.match(statements[3], /USING hnsw/);
});

test('metadata and vector validation rejects unsafe index input', () => {
  assert.equal(departmentKey(' KSIĘGOWOŚĆ '), 'księgowość');
  assert.throws(() => vectorLiteral(Array(1024).fill(0)), /zerowy/);
  assert.throws(() => vectorLiteral([1, 0]), /1024/);
  const base = {
    tenantId: TENANT, sourceType: 'folder', sourceId: SOURCE,
    checksum: 'a'.repeat(64), modelVersion: 'bge-m3:latest', embedding: VECTOR,
  };
  assert.throws(() => validateSource({ ...base, sourceType: 'hr_folder' }), /metadane/);
  assert.throws(() => validateSource({ ...base, checksum: 'not-a-hash' }), /metadane/);
  assert.throws(() => validateSource({ ...base, sourceType: 'transfer_list', department: 'Kadry' }), /Caly spis/);
  assert.equal(validateSource({ ...base, department: 'Księgowość' }).departmentKey, 'księgowość');
});

test('upsert is keyed by tenant and source, while removal is scoped', async () => {
  const calls = [];
  const db = { $executeRawUnsafe: async (...args) => { calls.push(args); return 1; } };
  await upsertSource(db, {
    tenantId: TENANT, sourceType: 'folder', sourceId: SOURCE, department: 'Księgowość',
    checksum: 'a'.repeat(64), modelVersion: 'bge-m3:latest', embedding: VECTOR,
  });
  assert.match(calls[0][0], /ON CONFLICT \(tenant_id, source_type, source_id\)/);
  assert.match(calls[0][0], /source_checksum IS DISTINCT FROM/);
  assert.deepEqual(calls[0].slice(1, 5), [TENANT, 'folder', SOURCE, 'księgowość']);
  await removeSource(db, TENANT, 'folder', SOURCE);
  assert.match(calls[1][0], /WHERE tenant_id = \$1::uuid AND source_type = \$2 AND source_id = \$3::uuid/);
  assert.deepEqual(calls[1].slice(1), [TENANT, 'folder', SOURCE]);
});

test('query always scopes tenant and model, and department when supplied', async () => {
  const calls = [];
  const db = { $queryRawUnsafe: async (...args) => { calls.push(args); return []; } };
  await searchIndex(db, { tenantId: TENANT, modelVersion: 'bge-m3:latest', embedding: VECTOR });
  await searchIndex(db, { tenantId: TENANT, department: ' Księgowość ', modelVersion: 'bge-m3:latest', embedding: VECTOR });
  assert.match(calls[0][0], /WHERE tenant_id = \$1::uuid AND model_version = \$2/);
  assert.doesNotMatch(calls[0][0], /department_key =/);
  assert.match(calls[1][0], /department_key = \$3/);
  assert.equal(calls[1][3], 'księgowość');
  await assert.rejects(searchIndex(db, { tenantId: TENANT, modelVersion: 'bge-m3:latest', embedding: VECTOR, limit: 100 }), /kontekst/);
});
