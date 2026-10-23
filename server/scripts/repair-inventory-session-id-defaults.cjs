const path = require('path');
const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const prisma = new PrismaClient();
const expectedTables = ['inventory_sessions', 'inventory_scans'];

async function main() {
  if (!process.argv.includes('--apply')) {
    console.error('Dodaj --apply, aby ustawic brakujace domyslne generatory UUID.');
    process.exitCode = 1;
    return;
  }

  const changed = await prisma.$transaction(async (tx) => {
    const [columns, functions] = await Promise.all([
      tx.$queryRaw`
        SELECT c.relname AS "table", format_type(a.atttypid, a.atttypmod) AS type,
               a.attnotnull AS required,
               pg_get_expr(d.adbin, d.adrelid) AS "defaultValue"
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE n.nspname = 'public'
          AND c.relname IN ('inventory_sessions', 'inventory_scans')
          AND c.relkind = 'r' AND a.attname = 'id'
          AND a.attnum > 0 AND NOT a.attisdropped
      `,
      tx.$queryRaw`
        SELECT EXISTS (
          SELECT 1 FROM pg_proc WHERE proname = 'gen_random_uuid' AND pronargs = 0
        ) AS available
      `,
    ]);

    if (columns.length !== 2 || functions[0]?.available !== true) {
      throw new Error('Brak oczekiwanych tabel lub funkcji gen_random_uuid().');
    }
    for (const table of expectedTables) {
      const column = columns.find((row) => row.table === table);
      if (column?.type !== 'uuid' || column.required !== true
        || (column.defaultValue !== null && column.defaultValue !== 'gen_random_uuid()')) {
        throw new Error(`Nieoczekiwana definicja kolumny ${table}.id; przerwano bez zmian.`);
      }
    }

    const missing = columns.filter((row) => row.defaultValue === null).map((row) => row.table);
    if (missing.includes('inventory_sessions')) {
      await tx.$executeRaw`ALTER TABLE "inventory_sessions" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()`;
    }
    if (missing.includes('inventory_scans')) {
      await tx.$executeRaw`ALTER TABLE "inventory_scans" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()`;
    }
    return missing;
  });

  console.log(`Ustawiono domyslny generator UUID: ${changed.length ? changed.join(', ') : 'juz ustawiony'}.`);
  console.log('Istniejace rekordy nie zostaly zmienione.');
}

main()
  .catch((error) => {
    console.error('Naprawa nie powiodla sie:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
