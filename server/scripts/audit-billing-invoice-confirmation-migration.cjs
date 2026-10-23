const path = require('path');
const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const prisma = new PrismaClient();
const migrationName = '20261008190000_add_billing_invoice_confirmation';
const expectedColumns = {
  invoiceNumber: 'character varying(100)',
  invoicedAt: 'timestamp(3) without time zone',
  invoicedById: 'uuid',
};

async function main() {
  const [history, columns, foreignKeys] = await Promise.all([
    prisma.$queryRaw`
      SELECT finished_at, rolled_back_at
      FROM "_prisma_migrations"
      WHERE migration_name = ${migrationName}
      ORDER BY started_at DESC
      LIMIT 1
    `,
    prisma.$queryRaw`
      SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type,
             a.attnotnull AS required,
             pg_get_expr(d.adbin, d.adrelid) AS "defaultValue"
      FROM pg_attribute a
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = to_regclass('billing_periods')
        AND a.attname IN ('invoiceNumber', 'invoicedAt', 'invoicedById')
        AND a.attnum > 0 AND NOT a.attisdropped
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
      WHERE c.conrelid = to_regclass('billing_periods')
        AND c.conname = 'billing_periods_invoicedById_fkey'
        AND c.contype = 'f'
    `,
  ]);

  const mismatches = [];
  function check(label, condition) {
    console.log(`${condition ? '[OK]' : '[BRAK]'} ${label}`);
    if (!condition) mismatches.push(label);
  }

  console.log(`Audyt migracji ${migrationName} (tylko odczyt):`);
  const actualColumns = new Map(columns.map((row) => [row.name, row]));
  for (const [name, type] of Object.entries(expectedColumns)) {
    const actual = actualColumns.get(name);
    check(`Kolumna billing_periods.${name}`, actual?.type === type
      && actual.required === false && actual.defaultValue == null);
  }

  const key = foreignKeys[0];
  check('Relacja billing_periods_invoicedById_fkey', foreignKeys.length === 1
    && key.column === 'invoicedById' && key.target === 'users'
    && key.targetColumn === 'id' && key.onDelete === 'n'
    && key.onUpdate === 'c' && key.valid === true);

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
