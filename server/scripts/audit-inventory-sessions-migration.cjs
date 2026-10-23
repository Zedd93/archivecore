const path = require('path');
const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const prisma = new PrismaClient();
const migrationName = '20261009120000_add_inventory_sessions';
const expectedColumns = {
  inventory_sessions: {
    id: ['uuid', true, 'gen_random_uuid()'],
    tenantId: ['uuid', true, null],
    locationId: ['uuid', true, null],
    locationPath: ['character varying(500)', true, null],
    expected: ['jsonb', true, null],
    excludedCount: ['integer', true, '0'],
    status: ['"InventorySessionStatus"', true, "'in_progress'::\"InventorySessionStatus\""],
    startedById: ['uuid', true, null],
    startedAt: ['timestamp(3) without time zone', true, 'CURRENT_TIMESTAMP'],
    finishedById: ['uuid', false, null],
    finishedAt: ['timestamp(3) without time zone', false, null],
  },
  inventory_scans: {
    id: ['uuid', true, 'gen_random_uuid()'],
    sessionId: ['uuid', true, null],
    boxId: ['uuid', true, null],
    boxData: ['jsonb', true, null],
    scannedById: ['uuid', true, null],
    scannedAt: ['timestamp(3) without time zone', true, 'CURRENT_TIMESTAMP'],
    voidedById: ['uuid', false, null],
    voidedAt: ['timestamp(3) without time zone', false, null],
  },
};
const expectedIndexes = {
  inventory_sessions_pkey: 'CREATE UNIQUE INDEX inventory_sessions_pkey ON public.inventory_sessions USING btree (id)',
  inventory_scans_pkey: 'CREATE UNIQUE INDEX inventory_scans_pkey ON public.inventory_scans USING btree (id)',
  inventory_sessions_tenantId_startedAt_idx: 'CREATE INDEX "inventory_sessions_tenantId_startedAt_idx" ON public.inventory_sessions USING btree ("tenantId", "startedAt")',
  inventory_scans_sessionId_voidedAt_scannedAt_idx: 'CREATE INDEX "inventory_scans_sessionId_voidedAt_scannedAt_idx" ON public.inventory_scans USING btree ("sessionId", "voidedAt", "scannedAt")',
};
const expectedKeys = {
  inventory_sessions_tenantId_fkey: ['inventory_sessions', 'tenantId', 'tenants', 'id', 'r'],
  inventory_sessions_locationId_fkey: ['inventory_sessions', 'locationId', 'locations', 'id', 'r'],
  inventory_scans_sessionId_fkey: ['inventory_scans', 'sessionId', 'inventory_sessions', 'id', 'c'],
};

async function main() {
  const [history, enumValues, columns, indexes, keys] = await Promise.all([
    prisma.$queryRaw`
      SELECT finished_at, rolled_back_at
      FROM "_prisma_migrations"
      WHERE migration_name = ${migrationName}
      ORDER BY started_at DESC LIMIT 1
    `,
    prisma.$queryRaw`
      SELECT e.enumlabel AS value
      FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public' AND t.typname = 'InventorySessionStatus'
      ORDER BY e.enumsortorder
    `,
    prisma.$queryRaw`
      SELECT c.relname AS "table", a.attname AS name,
             format_type(a.atttypid, a.atttypmod) AS type,
             a.attnotnull AS required,
             pg_get_expr(d.adbin, d.adrelid) AS "defaultValue"
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE n.nspname = 'public' AND c.relname IN ('inventory_sessions', 'inventory_scans')
        AND c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped
    `,
    prisma.$queryRaw`
      SELECT indexname AS name, indexdef AS definition
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename IN ('inventory_sessions', 'inventory_scans')
    `,
    prisma.$queryRaw`
      SELECT c.conname AS name, source.relname AS "table", a.attname AS column,
             target.relname AS target, referenced.attname AS "targetColumn",
             c.confdeltype AS "onDelete", c.confupdtype AS "onUpdate",
             c.convalidated AS valid
      FROM pg_constraint c
      JOIN pg_class source ON source.oid = c.conrelid
      JOIN pg_class target ON target.oid = c.confrelid
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      JOIN pg_attribute referenced ON referenced.attrelid = c.confrelid
        AND referenced.attnum = c.confkey[1]
      WHERE source.relname IN ('inventory_sessions', 'inventory_scans')
        AND c.contype = 'f'
    `,
  ]);

  const mismatches = [];
  function check(label, condition) {
    console.log(`${condition ? '[OK]' : '[BRAK]'} ${label}`);
    if (!condition) mismatches.push(label);
  }

  console.log(`Audyt migracji ${migrationName} (tylko odczyt):`);
  check('Typ InventorySessionStatus',
    JSON.stringify(enumValues.map((row) => row.value)) === JSON.stringify(['in_progress', 'completed']));

  const actualColumns = new Map(columns.map((row) => [`${row.table}.${row.name}`, row]));
  for (const [table, expected] of Object.entries(expectedColumns)) {
    for (const [name, [type, required, defaultValue]] of Object.entries(expected)) {
      const actual = actualColumns.get(`${table}.${name}`);
      check(`Kolumna ${table}.${name}`, actual?.type === type
        && actual.required === required && actual.defaultValue === defaultValue);
    }
  }

  const actualIndexes = new Map(indexes.map((row) => [row.name, row.definition]));
  for (const [name, definition] of Object.entries(expectedIndexes)) {
    check(`Indeks ${name}`, actualIndexes.get(name) === definition);
  }

  const actualKeys = new Map(keys.map((row) => [row.name, row]));
  for (const [name, [table, column, target, targetColumn, onDelete]] of Object.entries(expectedKeys)) {
    const actual = actualKeys.get(name);
    check(`Relacja ${name}`, actual?.table === table && actual.column === column
      && actual.target === target && actual.targetColumn === targetColumn
      && actual.onDelete === onDelete && actual.onUpdate === 'c' && actual.valid === true);
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
