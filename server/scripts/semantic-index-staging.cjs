const assert = require('node:assert/strict');
const { validateTarget, validateDataDirectory } = require('./smoke-pgvector-staging.cjs');

const ROLLBACK = new Error('Rollback synthetic semantic index records');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;
const MODEL = 'bge-m3:latest';
const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const FOLDER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const FOLDER_B = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';

function departmentKey(department) {
  if (department == null) return null;
  if (typeof department !== 'string' || !department.trim()) throw new Error('Niepoprawny dzial.');
  return department.trim().toLocaleLowerCase('pl-PL');
}

function vectorLiteral(vector) {
  if (!Array.isArray(vector) || vector.length !== 1024
    || vector.some((value) => typeof value !== 'number' || !Number.isFinite(value))
    || !vector.some((value) => value !== 0)) {
    throw new Error('Wektor musi miec 1024 skonczone wartosci i nie moze byc zerowy.');
  }
  return JSON.stringify(vector);
}

function validateSource(source) {
  if (!UUID.test(source.tenantId) || !UUID.test(source.sourceId)
    || !['folder', 'transfer_list'].includes(source.sourceType)
    || !SHA256.test(source.checksum)
    || typeof source.modelVersion !== 'string' || !source.modelVersion.trim()
    || source.modelVersion.length > 100) {
    throw new Error('Niepoprawne metadane zrodla indeksu.');
  }
  const key = departmentKey(source.department);
  if (source.sourceType === 'transfer_list' && key !== null) {
    throw new Error('Caly spis ZO nie moze nalezec do jednego dzialu.');
  }
  return { departmentKey: key, embedding: vectorLiteral(source.embedding) };
}

async function assertStagingTarget(db, databaseUrl, expectedDatabase, expectedDataDirectory) {
  validateTarget(databaseUrl, expectedDatabase, expectedDatabase);
  const [target] = await db.$queryRawUnsafe(`
    SELECT current_database() AS "database", current_setting('data_directory') AS "dataDirectory"
  `);
  validateTarget(databaseUrl, expectedDatabase, target.database);
  validateDataDirectory(target.dataDirectory, expectedDataDirectory);
}

async function initSchema(db) {
  await db.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS vector');
  await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS semantic_metadata_index (
    tenant_id uuid NOT NULL,
    source_type text NOT NULL CHECK (source_type IN ('folder', 'transfer_list')),
    source_id uuid NOT NULL,
    department_key text,
    source_checksum char(64) NOT NULL CHECK (source_checksum ~ '^[0-9a-f]{64}$'),
    model_version varchar(100) NOT NULL,
    embedding vector(1024) NOT NULL,
    indexed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, source_type, source_id),
    CHECK (source_type <> 'transfer_list' OR department_key IS NULL)
  )`);
  await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS semantic_metadata_scope_idx
    ON semantic_metadata_index (tenant_id, department_key, model_version)`);
  await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS semantic_metadata_hnsw_idx
    ON semantic_metadata_index USING hnsw (embedding vector_cosine_ops)`);
}

async function upsertSource(db, source) {
  const { departmentKey: key, embedding } = validateSource(source);
  return db.$executeRawUnsafe(`
    INSERT INTO semantic_metadata_index
      (tenant_id, source_type, source_id, department_key, source_checksum, model_version, embedding)
    VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6, $7::vector)
    ON CONFLICT (tenant_id, source_type, source_id) DO UPDATE SET
      department_key = EXCLUDED.department_key,
      source_checksum = EXCLUDED.source_checksum,
      model_version = EXCLUDED.model_version,
      embedding = EXCLUDED.embedding,
      indexed_at = now()
    WHERE semantic_metadata_index.department_key IS DISTINCT FROM EXCLUDED.department_key
       OR semantic_metadata_index.source_checksum IS DISTINCT FROM EXCLUDED.source_checksum
       OR semantic_metadata_index.model_version IS DISTINCT FROM EXCLUDED.model_version
  `, source.tenantId, source.sourceType, source.sourceId, key,
  source.checksum.toLowerCase(), source.modelVersion.trim(), embedding);
}

async function removeSource(db, tenantId, sourceType, sourceId) {
  if (!UUID.test(tenantId) || !UUID.test(sourceId) || !['folder', 'transfer_list'].includes(sourceType)) {
    throw new Error('Niepoprawny identyfikator zrodla.');
  }
  return db.$executeRawUnsafe(`DELETE FROM semantic_metadata_index
    WHERE tenant_id = $1::uuid AND source_type = $2 AND source_id = $3::uuid`,
  tenantId, sourceType, sourceId);
}

async function searchIndex(db, { tenantId, department, modelVersion, embedding, limit = 10 }) {
  if (!UUID.test(tenantId) || typeof modelVersion !== 'string' || !modelVersion.trim()
    || !Number.isSafeInteger(limit) || limit < 1 || limit > 20) {
    throw new Error('Niepoprawny kontekst wyszukiwania.');
  }
  const key = departmentKey(department);
  const vector = vectorLiteral(embedding);
  const scopedDepartment = key === null ? '' : 'AND department_key = $3';
  const vectorParameter = key === null ? '$3' : '$4';
  const limitParameter = key === null ? '$4' : '$5';
  const sql = `SELECT source_type AS "type", source_id AS "id"
    FROM semantic_metadata_index
    WHERE tenant_id = $1::uuid AND model_version = $2 ${scopedDepartment}
    ORDER BY embedding <=> ${vectorParameter}::vector LIMIT ${limitParameter}`;
  return key === null
    ? db.$queryRawUnsafe(sql, tenantId, modelVersion.trim(), vector, limit)
    : db.$queryRawUnsafe(sql, tenantId, modelVersion.trim(), key, vector, limit);
}

function syntheticVector(first, second) {
  return [first, second, ...Array(1022).fill(0)];
}

async function smokeLifecycle(db) {
  const near = syntheticVector(1, 0);
  const far = syntheticVector(0, 1);
  try {
    await db.$transaction(async (tx) => {
      const base = { sourceType: 'folder', modelVersion: MODEL, department: 'Księgowość' };
      await upsertSource(tx, { ...base, tenantId: TENANT_A, sourceId: FOLDER_A, checksum: 'a'.repeat(64), embedding: near });
      await upsertSource(tx, { ...base, tenantId: TENANT_A, sourceId: FOLDER_B, checksum: 'b'.repeat(64), embedding: far });
      await upsertSource(tx, { ...base, tenantId: TENANT_B, sourceId: FOLDER_A, checksum: 'c'.repeat(64), embedding: near });
      let visible = await searchIndex(tx, { tenantId: TENANT_A, department: 'księgowość', modelVersion: MODEL, embedding: near });
      assert.deepEqual(visible.map((row) => row.id), [FOLDER_A, FOLDER_B]);

      await upsertSource(tx, { ...base, tenantId: TENANT_A, sourceId: FOLDER_A, checksum: 'd'.repeat(64), embedding: far });
      const [updated] = await tx.$queryRawUnsafe(`SELECT source_checksum AS "checksum"
        FROM semantic_metadata_index WHERE tenant_id = $1::uuid AND source_id = $2::uuid`, TENANT_A, FOLDER_A);
      assert.equal(updated.checksum, 'd'.repeat(64));

      await removeSource(tx, TENANT_A, 'folder', FOLDER_A);
      visible = await searchIndex(tx, { tenantId: TENANT_A, department: 'KSIĘGOWOŚĆ', modelVersion: MODEL, embedding: near });
      assert.deepEqual(visible.map((row) => row.id), [FOLDER_B]);
      throw ROLLBACK;
    }, { timeout: 30000 });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 5 || args[0] !== '--staging-db' || args[2] !== '--staging-data-dir'
    || !['--init', '--smoke'].includes(args[4])) {
    throw new Error('Uzycie: --staging-db NAZWA --staging-data-dir SCIEZKA --init|--smoke');
  }
  if (!process.env.DATABASE_URL) throw new Error('Ustaw DATABASE_URL testowej instancji. Plik .env nie jest wczytywany.');
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient();
  try {
    await assertStagingTarget(db, process.env.DATABASE_URL, args[1], args[3]);
    if (args[4] === '--init') {
      await initSchema(db);
      console.log('Utworzono schemat indeksu semantycznego tylko w bazie testowej.');
    } else {
      await smokeLifecycle(db);
      console.log('Zapis, aktualizacja, filtr tenanta i usuniecie dzialaja. Sztuczne rekordy wycofano.');
    }
  } finally {
    await db.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Indeks testowy:', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  departmentKey, vectorLiteral, validateSource, assertStagingTarget,
  initSchema, upsertSource, removeSource, searchIndex, smokeLifecycle,
};
