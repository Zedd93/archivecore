const assert = require('node:assert/strict');

const ROLLBACK = new Error('Rollback pgvector smoke test');

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
  if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && port === '5432') {
    throw new Error('Odmowa: lokalny port 5432 jest uzywany przez produkcyjny ArchiveCore.');
  }
}

async function smoke(db, databaseUrl, expectedDatabase) {
  validateTarget(databaseUrl, expectedDatabase, expectedDatabase);
  const [before] = await db.$queryRawUnsafe(`
    SELECT current_database() AS "database",
      EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') AS "available",
      EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS "enabled"
  `);
  validateTarget(databaseUrl, expectedDatabase, before.database);
  if (!before.available) throw new Error('pgvector nie jest zainstalowany na tej instancji testowej.');

  try {
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS vector');
      await tx.$executeRawUnsafe('CREATE TEMP TABLE semantic_vector_smoke (id text PRIMARY KEY, embedding vector(3)) ON COMMIT DROP');
      await tx.$executeRawUnsafe("INSERT INTO semantic_vector_smoke VALUES ('blisko', '[1,0,0]'), ('daleko', '[0,1,0]')");
      const rows = await tx.$queryRawUnsafe(
        "SELECT id FROM semantic_vector_smoke ORDER BY embedding <=> '[1,0,0]'::vector LIMIT 1"
      );
      assert.equal(rows[0]?.id, 'blisko', 'pgvector zwrocil bledna kolejnosc podobienstwa.');
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
  if (args.length !== 2 || args[0] !== '--staging-db') throw new Error('Uzycie: --staging-db NAZWA');
  if (!process.env.DATABASE_URL) throw new Error('Ustaw DATABASE_URL osobnej instancji testowej. Plik .env nie jest wczytywany.');
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient();
  try {
    const result = await smoke(db, process.env.DATABASE_URL, args[1]);
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

module.exports = { validateTarget, smoke };
