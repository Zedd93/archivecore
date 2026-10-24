const path = require('path');
const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const prisma = new PrismaClient();
const migrationName = '20261009220000_add_hr_retention_basis';

const expectedEnums = {
  HRRiaStatus: ['unknown', 'not_submitted', 'submitted'],
  HRRetentionBasis: ['needs_review', 'pre_1999', 'transitional_50', 'transitional_ria', 'post_2018'],
};

const expectedColumns = {
  riaStatus: { type: 'HRRiaStatus', nullable: false, defaultValue: 'unknown' },
  riaSubmittedAt: { type: 'date', nullable: true },
  retentionBasis: { type: 'HRRetentionBasis', nullable: false, defaultValue: 'needs_review' },
  retentionReviewRequired: { type: 'bool', nullable: false, defaultValue: 'false' },
};

async function main() {
  const [history, enumRows, columns] = await Promise.all([
    prisma.$queryRaw`
      SELECT finished_at, rolled_back_at
      FROM "_prisma_migrations"
      WHERE migration_name = ${migrationName}
      ORDER BY started_at DESC LIMIT 1
    `,
    prisma.$queryRaw`
      SELECT t.typname AS type, e.enumlabel AS value
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public'
        AND t.typname IN ('HRRiaStatus', 'HRRetentionBasis')
      ORDER BY e.enumsortorder
    `,
    prisma.$queryRaw`
      SELECT a.attname AS name, t.typname AS type,
        a.attnotnull AS required,
        pg_get_expr(d.adbin, d.adrelid) AS default_value
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_type t ON t.oid = a.atttypid
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE n.nspname = 'public' AND c.relname = 'hr_folders'
        AND a.attname IN ('riaStatus', 'riaSubmittedAt', 'retentionBasis', 'retentionReviewRequired')
        AND a.attnum > 0 AND NOT a.attisdropped
    `,
  ]);

  let differences = 0;
  function check(label, matches, actual) {
    console.log(`${matches ? '[OK]' : '[BRAK]'} ${label}`);
    if (!matches) {
      differences += 1;
      if (actual !== undefined) console.log(`  Odczytano: ${actual}`);
    }
  }

  console.log(`Audyt migracji ${migrationName} (tylko odczyt):`);
  for (const [name, labels] of Object.entries(expectedEnums)) {
    const actual = enumRows.filter((row) => row.type === name).map((row) => row.value);
    check(`Typ ${name}`, JSON.stringify(actual) === JSON.stringify(labels), actual.join(', ') || 'brak');
  }

  for (const [name, expected] of Object.entries(expectedColumns)) {
    const column = columns.find((row) => row.name === name);
    check(`Kolumna hr_folders.${name}`, Boolean(column), column ? undefined : 'brak');
    if (!column) continue;
    check(`Typ ${name}`, column.type === expected.type, column.type);
    check(`Wymagalnosc ${name}`, column.required === !expected.nullable, column.required);
    const defaultMatches = expected.defaultValue === undefined
      ? column.default_value === null
      : column.default_value === expected.defaultValue
        || column.default_value?.startsWith(`'${expected.defaultValue}'::`);
    check(`Wartosc domyslna ${name}`, defaultMatches, column.default_value);
  }

  const latest = history[0];
  const status = !latest ? 'brak wpisu'
    : latest.finished_at ? 'zastosowana'
    : latest.rolled_back_at ? 'wycofana'
    : 'nieudana / w toku';
  console.log(`Historia Prisma: ${status}`);
  console.log(`Rozbieznosci: ${differences}`);
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
