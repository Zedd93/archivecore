const path = require('path');
const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const prisma = new PrismaClient();
const migrationName = '20261012110000_add_order_scan_files';

const expectedColumns = {
  id: ['uuid', true, null],
  tenantId: ['uuid', true, null],
  orderItemId: ['uuid', true, null],
  storageKey: ['character varying(1000)', true, null],
  fileName: ['character varying(500)', true, null],
  fileSize: ['integer', true, null],
  checksumSha256: ['character varying(64)', true, null],
  pageCount: ['integer', true, null],
  uploadedById: ['uuid', true, null],
  uploadedAt: ['timestamp(3) without time zone', true, 'CURRENT_TIMESTAMP'],
};

async function main() {
  const [history, enumValues, table, columns, indexes, constraints] = await Promise.all([
    prisma.$queryRaw`
      SELECT finished_at, rolled_back_at
      FROM "_prisma_migrations"
      WHERE migration_name = ${migrationName}
      ORDER BY started_at DESC LIMIT 1
    `,
    prisma.$queryRaw`
      SELECT e.enumlabel AS value
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public' AND t.typname = 'OrderType'
    `,
    prisma.$queryRaw`
      SELECT to_regclass('public.order_scan_files')::text AS name
    `,
    prisma.$queryRaw`
      SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type,
        a.attnotnull AS required,
        pg_get_expr(d.adbin, d.adrelid) AS "defaultValue"
      FROM pg_attribute a
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = to_regclass('public.order_scan_files')
        AND a.attnum > 0 AND NOT a.attisdropped
    `,
    prisma.$queryRaw`
      SELECT ic.relname AS name, i.indisunique AS "isUnique",
        i.indisprimary AS "isPrimary",
        ARRAY(
          SELECT a.attname
          FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, position)
          JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
          ORDER BY k.position
        ) AS columns
      FROM pg_index i
      JOIN pg_class ic ON ic.oid = i.indexrelid
      WHERE i.indrelid = to_regclass('public.order_scan_files')
    `,
    prisma.$queryRaw`
      SELECT conname AS name, contype AS type, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = to_regclass('public.order_scan_files')
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
  check('Typ OrderType.scan', enumValues.some((row) => row.value === 'scan'));
  check('Tabela order_scan_files', Boolean(table[0]?.name));

  const actualColumns = new Map(columns.map((row) => [row.name, row]));
  for (const [name, [type, required, defaultValue]] of Object.entries(expectedColumns)) {
    const actual = actualColumns.get(name);
    check(`Kolumna ${name}`, actual?.type === type && actual.required === required
      && actual.defaultValue === defaultValue,
    actual ? `${actual.type}, required=${actual.required}, default=${actual.defaultValue}` : 'brak');
  }

  for (const [name, keys, primary] of [
    ['order_scan_files_pkey', ['id'], true],
    ['order_scan_files_orderItemId_key', ['orderItemId'], false],
    ['order_scan_files_tenantId_idx', ['tenantId'], false],
  ]) {
    const actual = indexes.find((index) => index.name === name);
    const unique = name !== 'order_scan_files_tenantId_idx';
    check(`Indeks ${name}`, actual?.isUnique === unique && actual.isPrimary === primary
      && JSON.stringify(actual.columns) === JSON.stringify(keys),
    actual ? `${actual.columns.join(', ')}, unique=${actual.isUnique}, primary=${actual.isPrimary}` : 'brak');
  }

  for (const [name, column, target] of [
    ['order_scan_files_tenantId_fkey', 'tenantId', 'tenants'],
    ['order_scan_files_orderItemId_fkey', 'orderItemId', 'order_items'],
    ['order_scan_files_uploadedById_fkey', 'uploadedById', 'users'],
  ]) {
    const actual = constraints.find((constraint) => constraint.name === name);
    check(`Klucz obcy ${name}`, actual?.type === 'f'
      && actual.definition.includes(`FOREIGN KEY ("${column}") REFERENCES ${target}(id)`)
      && actual.definition.includes('ON UPDATE CASCADE')
      && actual.definition.includes('ON DELETE RESTRICT'),
    actual?.definition || 'brak');
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
