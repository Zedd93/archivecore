const path = require('path');
const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const prisma = new PrismaClient();
const migrationName = '20261013160000_add_warehouse_operations';
const expectedColumns = {
  id: ['uuid', true, null],
  tenantId: ['uuid', true, null],
  userId: ['uuid', true, null],
  operationType: ['character varying(20)', true, null],
  requestHash: ['character varying(64)', true, null],
  response: ['jsonb', false, null],
  createdAt: ['timestamp(3) without time zone', true, 'CURRENT_TIMESTAMP'],
};

async function main() {
  const [history, table, columns, indexes, constraints] = await Promise.all([
    prisma.$queryRaw`
      SELECT finished_at, rolled_back_at FROM "_prisma_migrations"
      WHERE migration_name = ${migrationName} ORDER BY started_at DESC LIMIT 1
    `,
    prisma.$queryRaw`SELECT to_regclass('public.warehouse_operations')::text AS name`,
    prisma.$queryRaw`
      SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type,
        a.attnotnull AS required, pg_get_expr(d.adbin, d.adrelid) AS "defaultValue"
      FROM pg_attribute a
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = to_regclass('public.warehouse_operations')
        AND a.attnum > 0 AND NOT a.attisdropped
    `,
    prisma.$queryRaw`
      SELECT ic.relname AS name, i.indisunique AS "isUnique", i.indisprimary AS "isPrimary",
        ARRAY(
          SELECT a.attname FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, position)
          JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
          ORDER BY k.position
        ) AS columns
      FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid
      WHERE i.indrelid = to_regclass('public.warehouse_operations')
    `,
    prisma.$queryRaw`
      SELECT conname AS name, contype AS type, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint WHERE conrelid = to_regclass('public.warehouse_operations')
    `,
  ]);

  let differences = 0;
  function check(label, matches) {
    console.log(`${matches ? '[OK]' : '[BRAK]'} ${label}`);
    if (!matches) differences += 1;
  }

  console.log(`Audyt migracji ${migrationName} (tylko odczyt):`);
  check('Tabela warehouse_operations', Boolean(table[0]?.name));
  const actualColumns = new Map(columns.map((column) => [column.name, column]));
  for (const [name, [type, required, defaultValue]] of Object.entries(expectedColumns)) {
    const actual = actualColumns.get(name);
    check(`Kolumna ${name}`, actual?.type === type && actual.required === required
      && actual.defaultValue === defaultValue);
  }

  for (const [name, keys, primary, unique] of [
    ['warehouse_operations_pkey', ['id'], true, true],
    ['warehouse_operations_tenantId_createdAt_idx', ['tenantId', 'createdAt'], false, false],
  ]) {
    const index = indexes.find((item) => item.name === name);
    check(`Indeks ${name}`, index?.isPrimary === primary && index.isUnique === unique
      && JSON.stringify(index.columns) === JSON.stringify(keys));
  }

  for (const [name, column, target] of [
    ['warehouse_operations_tenantId_fkey', 'tenantId', 'tenants'],
    ['warehouse_operations_userId_fkey', 'userId', 'users'],
  ]) {
    const constraint = constraints.find((item) => item.name === name);
    check(`Klucz obcy ${name}`, constraint?.type === 'f'
      && constraint.definition.includes(`FOREIGN KEY ("${column}") REFERENCES ${target}(id)`)
      && constraint.definition.includes('ON DELETE RESTRICT')
      && constraint.definition.includes('ON UPDATE CASCADE'));
  }

  const latest = history[0];
  const status = !latest ? 'brak wpisu' : latest.finished_at ? 'zastosowana'
    : latest.rolled_back_at ? 'wycofana' : 'nieudana / w toku';
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
