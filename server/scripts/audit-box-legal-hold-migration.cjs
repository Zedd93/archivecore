const path = require('path');
const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const prisma = new PrismaClient();
const migrationName = '20261009160000_add_box_legal_hold';
const expectedColumns = {
  legalHold: ['boolean', true, 'false'],
  legalHoldReason: ['text', false, null],
  legalHoldAt: ['timestamp(3) without time zone', false, null],
};

async function main() {
  const [history, columns] = await Promise.all([
    prisma.$queryRaw`
      SELECT finished_at, rolled_back_at
      FROM "_prisma_migrations"
      WHERE migration_name = ${migrationName}
      ORDER BY started_at DESC LIMIT 1
    `,
    prisma.$queryRaw`
      SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type,
             a.attnotnull AS required,
             pg_get_expr(d.adbin, d.adrelid) AS "defaultValue"
      FROM pg_attribute a
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = to_regclass('public.boxes')
        AND a.attnum > 0 AND NOT a.attisdropped
    `,
  ]);

  const actualColumns = new Map(columns.map((row) => [row.name, row]));
  let differences = 0;
  console.log(`Audyt migracji ${migrationName} (tylko odczyt):`);
  for (const [name, [type, required, defaultValue]] of Object.entries(expectedColumns)) {
    const actual = actualColumns.get(name);
    const matches = actual?.type === type && actual.required === required
      && actual.defaultValue === defaultValue;
    console.log(`${matches ? '[OK]' : '[BRAK]'} boxes.${name}`);
    if (!matches) {
      differences += 1;
      console.log(`  Odczytano: ${actual ? `${actual.type}, required=${actual.required}, default=${actual.defaultValue}` : 'brak kolumny'}`);
    }
  }

  const latest = history[0];
  const status = !latest ? 'brak wpisu'
    : latest.finished_at ? 'zastosowana'
    : latest.rolled_back_at ? 'wycofana'
    : 'nieudana / w toku';
  console.log(`Historia Prisma: ${status}`);
  console.log(`Rozbieznosci schematu: ${differences}`);
  console.log('Dane nie zostaly zmienione.');
  if (differences > 0 || status === 'nieudana / w toku') process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error('Audyt migracji nie powiodl sie:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
