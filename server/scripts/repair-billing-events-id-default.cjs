const path = require('path');
const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const prisma = new PrismaClient();
const migrationName = '20261008111500_add_billing_events';

async function inspect(db) {
  const [history, columns] = await Promise.all([
    db.$queryRaw`
      SELECT finished_at, rolled_back_at
      FROM "_prisma_migrations"
      WHERE migration_name = ${migrationName}
      ORDER BY started_at DESC
      LIMIT 1
    `,
    db.$queryRaw`
      SELECT pg_get_expr(d.adbin, d.adrelid) AS "defaultValue"
      FROM pg_attribute a
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = to_regclass('billing_events')
        AND a.attname = 'id' AND NOT a.attisdropped
    `,
  ]);

  if (history.length > 0) {
    throw new Error(`Migracja ${migrationName} ma juz wpis w historii Prisma.`);
  }
  if (columns.length !== 1 || columns[0].defaultValue !== null) {
    throw new Error('Kolumna billing_events.id nie istnieje albo ma juz wartosc domyslna.');
  }
}

async function main() {
  if (process.argv.slice(2).some((arg) => arg !== '--apply')) {
    throw new Error('Dozwolona opcja: --apply');
  }
  await inspect(prisma);
  console.log('Brakuje wartosci domyslnej billing_events.id; migracja nie ma wpisu w Prisma.');
  if (!process.argv.includes('--apply')) {
    console.log('Podglad: dane nie zostaly zmienione.');
    return;
  }

  await prisma.$transaction(async (tx) => {
    await inspect(tx);
    await tx.$executeRawUnsafe(
      'ALTER TABLE "billing_events" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()'
    );
  });
  console.log('Ustawiono wartosc domyslna UUID. Uruchom audyt przed uzgodnieniem historii Prisma.');
}

main()
  .catch((error) => {
    console.error('Naprawa migracji nie powiodla sie:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
