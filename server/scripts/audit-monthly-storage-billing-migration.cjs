const path = require('path');
const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const prisma = new PrismaClient();
const migrationName = '20261008123000_add_monthly_storage_billing';
const expectedColumns = {
  id: ['uuid', true, /^gen_random_uuid\(\)$/i],
  tenantId: ['uuid', true, null],
  periodStart: ['date', true, null],
  status: ['"BillingPeriodStatus"', true, /^'open'::"BillingPeriodStatus"$/],
  generatedAt: ['timestamp(3) without time zone', false, null],
  closedAt: ['timestamp(3) without time zone', false, null],
  closedById: ['uuid', false, null],
  createdAt: ['timestamp(3) without time zone', true, /^(?:CURRENT_TIMESTAMP|now\(\))$/i],
  updatedAt: ['timestamp(3) without time zone', true, null],
};
const expectedIndexes = {
  billing_periods_pkey: { columns: ['id'], unique: true, primary: true },
  billing_periods_tenantId_periodStart_key: {
    columns: ['tenantId', 'periodStart'], unique: true, primary: false,
  },
  billing_periods_tenantId_status_idx: {
    columns: ['tenantId', 'status'], unique: false, primary: false,
  },
};
const expectedForeignKeys = {
  billing_periods_tenantId_fkey: ['tenantId', 'tenants', 'r'],
  billing_periods_closedById_fkey: ['closedById', 'users', 'n'],
};

async function main() {
  const [history, catalog, locationColumns, periodColumns, indexes, foreignKeys, enumValues] =
    await Promise.all([
      prisma.$queryRaw`
        SELECT finished_at, rolled_back_at FROM "_prisma_migrations"
        WHERE migration_name = ${migrationName}
        ORDER BY started_at DESC LIMIT 1
      `,
      prisma.$queryRaw`
        SELECT to_regtype('"BillingPeriodStatus"') IS NOT NULL AS "enumExists",
               to_regclass('billing_periods') IS NOT NULL AS "tableExists"
      `,
      prisma.$queryRaw`
        SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type,
               a.attnotnull AS required,
               pg_get_expr(d.adbin, d.adrelid) AS "defaultValue"
        FROM pg_attribute a
        LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attrelid = to_regclass('locations')
          AND a.attname = 'isBillableStorage' AND a.attnum > 0 AND NOT a.attisdropped
      `,
      prisma.$queryRaw`
        SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type,
               a.attnotnull AS required,
               pg_get_expr(d.adbin, d.adrelid) AS "defaultValue"
        FROM pg_attribute a
        LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attrelid = to_regclass('billing_periods')
          AND a.attnum > 0 AND NOT a.attisdropped
      `,
      prisma.$queryRaw`
        SELECT c.relname AS name, i.indisunique AS "unique",
               i.indisprimary AS "primary", i.indisvalid AS valid,
               i.indpred IS NULL AS "notPartial",
               array_agg(a.attname ORDER BY keys.ordinality) AS columns
        FROM pg_index i
        JOIN pg_class c ON c.oid = i.indexrelid
        JOIN pg_attribute a ON a.attrelid = i.indrelid
        JOIN unnest(i.indkey) WITH ORDINALITY AS keys(attnum, ordinality)
          ON a.attnum = keys.attnum
        WHERE i.indrelid = to_regclass('billing_periods')
        GROUP BY c.relname, i.indisunique, i.indisprimary, i.indisvalid,
                 (i.indpred IS NULL)
      `,
      prisma.$queryRaw`
        SELECT c.conname AS name, a.attname AS column,
               target.relname AS target, referenced.attname AS "targetColumn",
               c.confdeltype AS "onDelete", c.confupdtype AS "onUpdate",
               c.convalidated AS valid
        FROM pg_constraint c
        JOIN pg_class target ON target.oid = c.confrelid
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        JOIN pg_attribute referenced ON referenced.attrelid = c.confrelid
          AND referenced.attnum = c.confkey[1]
        WHERE c.conrelid = to_regclass('billing_periods') AND c.contype = 'f'
      `,
      prisma.$queryRaw`
        SELECT enumlabel FROM pg_enum
        WHERE enumtypid = to_regtype('"BillingPeriodStatus"')
        ORDER BY enumsortorder
      `,
    ]);

  const mismatches = [];
  function check(label, condition) {
    console.log(`${condition ? '[OK]' : '[BRAK]'} ${label}`);
    if (!condition) mismatches.push(label);
  }

  console.log(`Audyt migracji ${migrationName} (tylko odczyt):`);
  check('Typ BillingPeriodStatus', catalog[0].enumExists);
  check('Wartosci statusu', JSON.stringify(enumValues.map((row) => row.enumlabel))
    === JSON.stringify(['open', 'closed']));
  check('Tabela billing_periods', catalog[0].tableExists);
  const locationColumn = locationColumns[0];
  check('Kolumna locations.isBillableStorage', locationColumn?.type === 'boolean'
    && locationColumn.required === true && locationColumn.defaultValue === 'false');

  const actualColumns = new Map(periodColumns.map((row) => [row.name, row]));
  for (const [name, [type, required, expectedDefault]] of Object.entries(expectedColumns)) {
    const actual = actualColumns.get(name);
    check(`Kolumna billing_periods.${name}`, actual?.type === type
      && actual.required === required);
    const defaultMatches = expectedDefault
      ? expectedDefault.test(actual?.defaultValue ?? '')
      : actual?.defaultValue == null;
    check(`Domyslna wartosc ${name}${defaultMatches ? ''
      : ` (faktyczna: ${actual?.defaultValue ?? '(brak)'})`}`, defaultMatches);
  }

  const actualIndexes = new Map(indexes.map((row) => [row.name, row]));
  for (const [name, expected] of Object.entries(expectedIndexes)) {
    const actual = actualIndexes.get(name);
    check(`Indeks ${name}`, actual?.unique === expected.unique
      && actual?.primary === expected.primary && actual?.valid === true
      && actual?.notPartial === true
      && JSON.stringify(actual?.columns) === JSON.stringify(expected.columns));
  }

  const actualForeignKeys = new Map(foreignKeys.map((row) => [row.name, row]));
  for (const [name, [column, target, onDelete]] of Object.entries(expectedForeignKeys)) {
    const actual = actualForeignKeys.get(name);
    check(`Relacja ${name}`, actual?.column === column && actual?.target === target
      && actual?.targetColumn === 'id' && actual?.onDelete === onDelete
      && actual?.onUpdate === 'c' && actual?.valid === true);
  }

  const latest = history[0];
  const status = !latest ? 'brak wpisu'
    : latest.finished_at ? 'zastosowana'
    : latest.rolled_back_at ? 'wycofana'
    : 'nieudana / w toku';
  console.log(`Historia Prisma: ${status}`);
  console.log(`Rozbieznosci schematu: ${mismatches.length}`);
  if (mismatches.length > 0) console.log(`Do sprawdzenia: ${mismatches.join(', ')}`);
  console.log('Dane nie zostaly zmienione.');
  if (mismatches.length > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error('Audyt migracji nie powiodl sie:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
