const assert = require('node:assert/strict');
const path = require('node:path');

const ROLLBACK = new Error('Rollback pgvector smoke test');
const PRODUCTION_DATA_DIRECTORY = 'C:\\Program Files\\PostgreSQL\\16\\data';

function normalizeDataDirectory(directory) {
  if (!directory || !path.win32.isAbsolute(directory)) {
    throw new Error('Podaj bezwzgledna sciezke katalogu danych instancji testowej.');
  }
  return path.win32.normalize(directory).replace(/[\\/]+$/, '').toLowerCase();
}

function validateDataDirectory(actualDirectory, expectedDirectory) {
  const actual = normalizeDataDirectory(actualDirectory);
  const expected = normalizeDataDirectory(expectedDirectory);
  if (actual === normalizeDataDirectory(PRODUCTION_DATA_DIRECTORY)) {
    throw new Error('Odmowa: polaczono z produkcyjnym katalogiem danych PostgreSQL.');
  }
  if (actual !== expected) {
    throw new Error('Katalog danych bazy nie zgadza sie z --staging-data-dir.');
  }
}

function validateTarget(databaseUrl, expectedDatabase, actualDatabase) {
  if (!databaseUrl || !expectedDatabase) throw new Error('Podaj DATABASE_URL instancji testowej i --staging-db NAZWA.');
  const url = new URL(databaseUrl);
  const database = decodeURIComponent(url.pathname.slice(1));
  const port = url.port || '5432';
  if (!['postgresql:', 'postgres:'].includes(url.protocol)) throw new Error('DATABASE_URL musi wskazywac PostgreSQL.');
  if (!/stag|test/i.test(expectedDatabase) || expectedDatabase.toLowerCase() === 'archivecore') {
    throw new Error('Nazwa bazy testowej musi zawierac staging lub test.');
  }
  if (database !== expectedDatabase || actualDatabase !== expectedDatabase) {
    throw new Error('DATABASE_URL, --staging-db i aktualna baza musza byc zgodne.');
  }
  if (port === '5432') {
    throw new Error('Odmowa: port 5432 moze wskazywac produkcyjny ArchiveCore. Uzyj osobnej instancji testowej na innym porcie.');
  }
}

async function smoke(db, databaseUrl, expectedDatabase, expectedDataDirectory) {
  validateTarget(databaseUrl, expectedDatabase, expectedDatabase);
  normalizeDataDirectory(expectedDataDirectory);
  const [before] = await db.$queryRawUnsafe(`
    SELECT current_database() AS "database",
      current_setting('data_directory') AS "dataDirectory",
      EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') AS "available",
      EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS "enabled"
  `);
  validateTarget(databaseUrl, expectedDatabase, before.database);
  validateDataDirectory(before.dataDirectory, expectedDataDirectory);
  if (!before.available) throw new Error('pgvector nie jest zainstalowany na tej instancji testowej.');

  try {
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS vector');
      await tx.$executeRawUnsafe('CREATE TEMP TABLE semantic_vector_smoke (id text PRIMARY KEY, tenant text NOT NULL, department text NOT NULL, embedding vector(3)) ON COMMIT DROP');
      await tx.$executeRawUnsafe("INSERT INTO semantic_vector_smoke VALUES ('blisko', 'tenant-a', 'dzial-a', '[1,0,0]'), ('daleko', 'tenant-a', 'dzial-a', '[0,1,0]')");
      const rows = await tx.$queryRawUnsafe(
        "SELECT id FROM semantic_vector_smoke ORDER BY embedding <=> '[1,0,0]'::vector LIMIT 1"
      );
      assert.equal(rows[0]?.id, 'blisko', 'pgvector zwrocil bledna kolejnosc podobienstwa.');
      await tx.$executeRawUnsafe("INSERT INTO semantic_vector_smoke VALUES ('inny-tenant', 'tenant-b', 'dzial-a', '[1,0,0]'), ('inny-dzial', 'tenant-a', 'dzial-b', '[1,0,0]')");
      const visible = await tx.$queryRawUnsafe(
        "SELECT id FROM semantic_vector_smoke WHERE tenant = $1 AND department = $2 ORDER BY embedding <=> '[1,0,0]'::vector LIMIT 10",
        'tenant-a', 'dzial-a'
      );
      assert.deepEqual(visible.map((row) => row.id), ['blisko', 'daleko'], 'Filtr tenant/dzial ujawnil obcy rekord.');
      throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }

  const [after] = await db.$queryRawUnsafe(`
    SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS "enabled"
  `);
  assert.equal(after.enabled, before.enabled, 'Stan rozszerzenia zmienil sie po wycofaniu transakcji.');
  return { database: before.database, extensionWasEnabled: before.enabled };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--staging-db' || args[2] !== '--staging-data-dir') {
    throw new Error('Uzycie: --staging-db NAZWA --staging-data-dir SCIEZKA');
  }
  if (!process.env.DATABASE_URL) throw new Error('Ustaw DATABASE_URL osobnej instancji testowej. Plik .env nie jest wczytywany.');
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient();
  try {
    const result = await smoke(db, process.env.DATABASE_URL, args[1], args[3]);
    console.log(`pgvector dziala w bazie testowej ${result.database}. Transakcje wycofano; stan rozszerzenia bez zmian.`);
  } finally {
    await db.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Test pgvector nie powiodl sie:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { validateTarget, validateDataDirectory, smoke };
