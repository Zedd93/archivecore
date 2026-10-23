const path = require('path');
const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const prisma = new PrismaClient();
const migrationName = '20261009150000_add_inventory_resolution_events';
const table = 'inventory_resolution_events';
const expectedColumns = {
  id: ['uuid', true, 'gen_random_uuid()'],
  sequence: ['integer', true, "nextval('inventory_resolution_events_sequence_seq'::regclass)"],
  sessionId: ['uuid', true, null],
  boxId: ['uuid', true, null],
  kind: ['character varying(30)', true, null],
  action: ['character varying(20)', true, null],
  note: ['text', true, null],
  userId: ['uuid', true, null],
  createdAt: ['timestamp(3) without time zone', true, 'CURRENT_TIMESTAMP'],
};
const expectedIndexes = {
  inventory_resolution_events_pkey:
    'CREATE UNIQUE INDEX inventory_resolution_events_pkey ON public.inventory_resolution_events USING btree (id)',
  inventory_resolution_events_sequence_key:
    'CREATE UNIQUE INDEX inventory_resolution_events_sequence_key ON public.inventory_resolution_events USING btree (sequence)',
  inventory_resolution_events_sessionId_boxId_kind_sequence_idx:
    'CREATE INDEX "inventory_resolution_events_sessionId_boxId_kind_sequence_idx" ON public.inventory_resolution_events USING btree ("sessionId", "boxId", kind, sequence)',
};

async function main() {
  const [history, columns, indexes, constraints, sequence] = await Promise.all([
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
      WHERE a.attrelid = to_regclass('public.inventory_resolution_events')
        AND a.attnum > 0 AND NOT a.attisdropped
    `,
    prisma.$queryRaw`
      SELECT indexname AS name, indexdef AS definition
      FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = ${table}
    `,
    prisma.$queryRaw`
      SELECT c.conname AS name, c.contype AS type,
             pg_get_constraintdef(c.oid) AS definition,
             a.attname AS column, target.relname AS target,
             referenced.attname AS "targetColumn",
             c.confdeltype AS "onDelete", c.confupdtype AS "onUpdate",
             c.convalidated AS valid
      FROM pg_constraint c
      LEFT JOIN pg_class target ON target.oid = c.confrelid
      LEFT JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      LEFT JOIN pg_attribute referenced ON referenced.attrelid = c.confrelid
        AND referenced.attnum = c.confkey[1]
      WHERE c.conrelid = to_regclass('public.inventory_resolution_events')
    `,
    prisma.$queryRaw`
      SELECT s.relname AS name, d.deptype AS dependency,
             a.attname AS column
      FROM pg_class s
      JOIN pg_depend d ON d.objid = s.oid AND d.classid = 'pg_class'::regclass
      JOIN pg_class t ON t.oid = d.refobjid
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
      WHERE s.relkind = 'S' AND t.oid = to_regclass('public.inventory_resolution_events')
    `,
  ]);

  const mismatches = [];
  function check(label, condition, actual) {
    console.log(`${condition ? '[OK]' : '[BRAK]'} ${label}`);
    if (!condition) {
      mismatches.push(label);
      if (actual !== undefined) console.log(`  Odczytano: ${actual}`);
    }
  }

  console.log(`Audyt migracji ${migrationName} (tylko odczyt):`);
  const actualColumns = new Map(columns.map((row) => [row.name, row]));
  for (const [name, [type, required, defaultValue]] of Object.entries(expectedColumns)) {
    const actual = actualColumns.get(name);
    check(`Kolumna ${table}.${name}`, actual?.type === type
      && actual.required === required && actual.defaultValue === defaultValue,
    actual && `${actual.type}, required=${actual.required}, default=${actual.defaultValue}`);
  }

  const actualIndexes = new Map(indexes.map((row) => [row.name, row.definition]));
  for (const [name, definition] of Object.entries(expectedIndexes)) {
    check(`Indeks ${name}`, actualIndexes.get(name) === definition, actualIndexes.get(name));
  }

  const actualConstraints = new Map(constraints.map((row) => [row.name, row]));
  const primaryKey = actualConstraints.get('inventory_resolution_events_pkey');
  check('Klucz glowny id', primaryKey?.type === 'p' && primaryKey.definition === 'PRIMARY KEY (id)'
    && primaryKey.valid === true);
  const uniqueKey = actualConstraints.get('inventory_resolution_events_sequence_key');
  check('Unikalna numeracja sequence', uniqueKey?.type === 'u'
    && uniqueKey.definition === 'UNIQUE (sequence)' && uniqueKey.valid === true);

  const expectedForeignKeys = {
    inventory_resolution_events_sessionId_fkey: ['sessionId', 'inventory_sessions', 'id', 'c'],
    inventory_resolution_events_userId_fkey: ['userId', 'users', 'id', 'r'],
  };
  for (const [name, [column, target, targetColumn, onDelete]] of Object.entries(expectedForeignKeys)) {
    const actual = actualConstraints.get(name);
    check(`Relacja ${name}`, actual?.type === 'f' && actual.column === column
      && actual.target === target && actual.targetColumn === targetColumn
      && actual.onDelete === onDelete && actual.onUpdate === 'c' && actual.valid === true);
  }

  check('Sekwencja SERIAL przypisana do kolumny sequence', sequence.length === 1
    && sequence[0].name === 'inventory_resolution_events_sequence_seq'
    && sequence[0].column === 'sequence' && sequence[0].dependency === 'a');

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
