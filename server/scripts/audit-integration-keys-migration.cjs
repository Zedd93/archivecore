const path = require('path');
const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const prisma = new PrismaClient();
const migrationName = '20261012140000_add_integration_keys';

const expectedColumns = {
  id: ['uuid', true, null],
  tenantId: ['uuid', true, null],
  createdById: ['uuid', true, null],
  name: ['character varying(100)', true, null],
  keyHash: ['character varying(64)', true, null],
  keyPrefix: ['character varying(24)', true, null],
  expiresAt: ['timestamp(3) without time zone', true, null],
  lastUsedAt: ['timestamp(3) without time zone', false, null],
  revokedAt: ['timestamp(3) without time zone', false, null],
  createdAt: ['timestamp(3) without time zone', true, 'CURRENT_TIMESTAMP'],
};

async function main() {
  const [history, table, columns, indexes, constraints] = await Promise.all([
    prisma.$queryRaw`
      SELECT finished_at, rolled_back_at
      FROM "_prisma_migrations"
      WHERE migration_name = ${migrationName}
      ORDER BY started_at DESC LIMIT 1
    `,
    prisma.$queryRaw`
      SELECT to_regclass('public.integration_keys')::text AS name
    `,
    prisma.$queryRaw`
      SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type,
        a.attnotnull AS required,
        pg_get_expr(d.adbin, d.adrelid) AS "defaultValue"
      FROM pg_attribute a
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = to_regclass('public.integration_keys')
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
      WHERE i.indrelid = to_regclass('public.integration_keys')
    `,
    prisma.$queryRaw`
      SELECT conname AS name, contype AS type, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = to_regclass('public.integration_keys')
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
  check('Tabela integration_keys', Boolean(table[0]?.name));

  const actualColumns = new Map(columns.map((row) => [row.name, row]));
  for (const [name, [type, required, defaultValue]] of Object.entries(expectedColumns)) {
    const actual = actualColumns.get(name);
    check(`Kolumna ${name}`, actual?.type === type && actual.required === required
      && actual.defaultValue === defaultValue,
    actual ? `${actual.type}, required=${actual.required}, default=${actual.defaultValue}` : 'brak');
  }

  for (const [name, keys, primary, unique] of [
    ['integration_keys_pkey', ['id'], true, true],
    ['integration_keys_keyHash_key', ['keyHash'], false, true],
    ['integration_keys_tenantId_revokedAt_idx', ['tenantId', 'revokedAt'], false, false],
  ]) {
    const actual = indexes.find((index) => index.name === name);
    check(`Indeks ${name}`, actual?.isUnique === unique && actual.isPrimary === primary
      && JSON.stringify(actual.columns) === JSON.stringify(keys),
    actual ? `${actual.columns.join(', ')}, unique=${actual.isUnique}, primary=${actual.isPrimary}` : 'brak');
  }

  for (const [name, column, target] of [
    ['integration_keys_tenantId_fkey', 'tenantId', 'tenants'],
    ['integration_keys_createdById_fkey', 'createdById', 'users'],
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
