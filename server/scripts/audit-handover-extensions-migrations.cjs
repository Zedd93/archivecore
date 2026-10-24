const path = require('path');
const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const prisma = new PrismaClient();
const migrations = [
  '20261013180000_add_handover_signature',
  '20261013190000_add_handover_box_checks',
  '20261013200000_add_handover_photos',
];
const expected = [
  {
    table: 'order_handover_proofs',
    columns: { signatureData: ['text', false, null] },
  },
  {
    table: 'order_handover_boxes',
    columns: {
      orderId: ['uuid', true, null],
      boxId: ['uuid', true, null],
      condition: ['character varying(20)', true, null],
      sealNumber: ['character varying(100)', false, null],
      conditionNote: ['character varying(1000)', false, null],
    },
    indexes: [
      ['order_handover_boxes_pkey', ['orderId', 'boxId'], true, true],
      ['order_handover_boxes_boxId_idx', ['boxId'], false, false],
    ],
    foreignKeys: [
      ['order_handover_boxes_orderId_fkey', 'orderId', 'order_handover_proofs', 'orderId', 'CASCADE'],
      ['order_handover_boxes_boxId_fkey', 'boxId', 'boxes', 'id', 'RESTRICT'],
    ],
  },
  {
    table: 'order_handover_photos',
    columns: {
      id: ['uuid', true, null],
      tenantId: ['uuid', true, null],
      orderId: ['uuid', true, null],
      boxId: ['uuid', false, null],
      storageKey: ['character varying(1000)', true, null],
      fileName: ['character varying(500)', true, null],
      mimeType: ['character varying(50)', true, null],
      fileSize: ['integer', true, null],
      checksumSha256: ['character varying(64)', true, null],
      uploadedById: ['uuid', true, null],
      uploadedAt: ['timestamp(3) without time zone', true, 'CURRENT_TIMESTAMP'],
    },
    indexes: [
      ['order_handover_photos_pkey', ['id'], true, true],
      ['order_handover_photos_orderId_checksumSha256_key', ['orderId', 'checksumSha256'], false, true],
      ['order_handover_photos_tenantId_orderId_idx', ['tenantId', 'orderId'], false, false],
      ['order_handover_photos_boxId_idx', ['boxId'], false, false],
    ],
    foreignKeys: [
      ['order_handover_photos_tenantId_fkey', 'tenantId', 'tenants', 'id', 'RESTRICT'],
      ['order_handover_photos_orderId_fkey', 'orderId', 'order_handover_proofs', 'orderId', 'CASCADE'],
      ['order_handover_photos_boxId_fkey', 'boxId', 'boxes', 'id', 'RESTRICT'],
      ['order_handover_photos_uploadedById_fkey', 'uploadedById', 'users', 'id', 'RESTRICT'],
    ],
  },
];

async function inspectTable(table) {
  const [columns, indexes, constraints] = await Promise.all([
    prisma.$queryRaw`
      SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type,
        a.attnotnull AS required, pg_get_expr(d.adbin, d.adrelid) AS "defaultValue"
      FROM pg_attribute a
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = to_regclass(${`public.${table}`})
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
      WHERE i.indrelid = to_regclass(${`public.${table}`})
    `,
    prisma.$queryRaw`
      SELECT conname AS name, contype AS type, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint WHERE conrelid = to_regclass(${`public.${table}`})
    `,
  ]);
  return { columns, indexes, constraints };
}

async function main() {
  let differences = 0;
  let badHistory = false;
  function check(label, matches) {
    console.log(`${matches ? '[OK]' : '[BRAK]'} ${label}`);
    if (!matches) differences += 1;
  }

  console.log('Audyt rozszerzen potwierdzenia przekazania (tylko odczyt):');
  for (let position = 0; position < expected.length; position += 1) {
    const spec = expected[position];
    const migrationName = migrations[position];
    const [history, registration, catalog] = await Promise.all([
      prisma.$queryRaw`
        SELECT finished_at, rolled_back_at FROM "_prisma_migrations"
        WHERE migration_name = ${migrationName} ORDER BY started_at DESC LIMIT 1
      `,
      prisma.$queryRaw`SELECT to_regclass(${`public.${spec.table}`})::text AS name`,
      inspectTable(spec.table),
    ]);

    console.log(`Migracja ${migrationName}:`);
    check(`Tabela ${spec.table}`, Boolean(registration[0]?.name));
    const columns = new Map(catalog.columns.map((column) => [column.name, column]));
    for (const [name, [type, required, defaultValue]] of Object.entries(spec.columns)) {
      const actual = columns.get(name);
      check(`Kolumna ${spec.table}.${name}`, actual?.type === type && actual.required === required
        && actual.defaultValue === defaultValue);
    }
    for (const [name, keys, primary, unique] of spec.indexes || []) {
      const actual = catalog.indexes.find((index) => index.name === name);
      check(`Indeks ${name}`, actual?.isPrimary === primary && actual.isUnique === unique
        && JSON.stringify(actual.columns) === JSON.stringify(keys));
    }
    for (const [name, column, target, targetColumn, deleteAction] of spec.foreignKeys || []) {
      const actual = catalog.constraints.find((constraint) => constraint.name === name);
      const referencedColumn = targetColumn === 'id' ? 'id' : `"${targetColumn}"`;
      check(`Klucz obcy ${name}`, actual?.type === 'f'
        && actual.definition.includes(`FOREIGN KEY ("${column}") REFERENCES ${target}(${referencedColumn})`)
        && actual.definition.includes(`ON DELETE ${deleteAction}`)
        && actual.definition.includes('ON UPDATE CASCADE'));
    }
    const latest = history[0];
    const status = !latest ? 'brak wpisu' : latest.finished_at ? 'zastosowana'
      : latest.rolled_back_at ? 'wycofana' : 'nieudana / w toku';
    console.log(`Historia Prisma: ${status}`);
    if (status === 'nieudana / w toku') badHistory = true;
  }
  console.log(`Rozbieznosci: ${differences}`);
  console.log('Dane nie zostaly zmienione.');
  if (differences > 0 || badHistory) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error('Audyt migracji nie powiodl sie:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
