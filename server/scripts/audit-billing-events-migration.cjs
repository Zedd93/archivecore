const path = require('path');
const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const prisma = new PrismaClient();
const migrationName = '20261008111500_add_billing_events';
const expectedColumns = [
  'id', 'tenantId', 'priceListId', 'priceListItemId', 'orderId', 'orderItemId',
  'serviceCode', 'serviceName', 'unit', 'quantity', 'unitPrice', 'netAmount',
  'vatRate', 'currency', 'sourceType', 'sourceId', 'description', 'occurredAt',
  'billingPeriod', 'status', 'excludedReason', 'createdAt', 'updatedAt',
];
const expectedIndexes = [
  'billing_events_pkey',
  'billing_events_sourceType_sourceId_serviceCode_key',
  'billing_events_tenantId_billingPeriod_status_idx',
  'billing_events_tenantId_occurredAt_idx',
  'billing_events_orderId_idx',
];
const expectedForeignKeys = [
  'billing_events_tenantId_fkey',
  'billing_events_priceListId_fkey',
  'billing_events_priceListItemId_fkey',
  'billing_events_orderId_fkey',
  'billing_events_orderItemId_fkey',
];
const expectedTypes = {
  id: 'uuid', tenantId: 'uuid', priceListId: 'uuid', priceListItemId: 'uuid',
  orderId: 'uuid', orderItemId: 'uuid', serviceCode: 'character varying(50)',
  serviceName: 'character varying(255)', unit: 'character varying(30)',
  quantity: 'numeric(12,2)', unitPrice: 'numeric(12,2)',
  netAmount: 'numeric(12,2)', vatRate: 'numeric(5,2)',
  currency: 'character varying(3)', sourceType: 'character varying(50)',
  sourceId: 'uuid', description: 'character varying(500)',
  occurredAt: 'timestamp(3) without time zone', billingPeriod: 'date',
  status: '"BillingEventStatus"', excludedReason: 'character varying(500)',
  createdAt: 'timestamp(3) without time zone',
  updatedAt: 'timestamp(3) without time zone',
};
const nullableColumns = new Set([
  'priceListId', 'priceListItemId', 'orderId', 'orderItemId',
  'unitPrice', 'netAmount', 'description', 'excludedReason',
]);
const expectedIndexColumns = {
  billing_events_pkey: ['id'],
  billing_events_sourceType_sourceId_serviceCode_key: ['sourceType', 'sourceId', 'serviceCode'],
  billing_events_tenantId_billingPeriod_status_idx: ['tenantId', 'billingPeriod', 'status'],
  billing_events_tenantId_occurredAt_idx: ['tenantId', 'occurredAt'],
  billing_events_orderId_idx: ['orderId'],
};
const expectedForeignKeyTargets = {
  billing_events_tenantId_fkey: ['tenantId', 'tenants', 'r'],
  billing_events_priceListId_fkey: ['priceListId', 'price_lists', 'r'],
  billing_events_priceListItemId_fkey: ['priceListItemId', 'price_list_items', 'r'],
  billing_events_orderId_fkey: ['orderId', 'orders', 'n'],
  billing_events_orderItemId_fkey: ['orderItemId', 'order_items', 'n'],
};

async function main() {
  const [history, catalog] = await Promise.all([
    prisma.$queryRaw`
      SELECT finished_at, rolled_back_at
      FROM "_prisma_migrations"
      WHERE migration_name = ${migrationName}
      ORDER BY started_at DESC
      LIMIT 1
    `,
    prisma.$queryRaw`
      SELECT
        to_regtype('"BillingEventStatus"') IS NOT NULL AS "enumExists",
        to_regclass('billing_events') IS NOT NULL AS "tableExists"
    `,
  ]);

  const [columns, indexes, foreignKeys, enumValues] = await Promise.all([
    prisma.$queryRaw`
      SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type,
             a.attnotnull AS required
      FROM pg_attribute a
      WHERE a.attrelid = to_regclass('billing_events')
        AND a.attnum > 0 AND NOT a.attisdropped
    `,
    prisma.$queryRaw`
      SELECT c.relname AS name, i.indisunique AS "unique",
             array_agg(a.attname ORDER BY keys.ordinality) AS columns
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      JOIN pg_attribute a ON a.attrelid = i.indrelid
      JOIN unnest(i.indkey) WITH ORDINALITY AS keys(attnum, ordinality)
        ON a.attnum = keys.attnum
      WHERE i.indrelid = to_regclass('billing_events')
      GROUP BY c.relname, i.indisunique
    `,
    prisma.$queryRaw`
      SELECT c.conname AS name, a.attname AS column,
             target.relname AS target, c.confdeltype AS "onDelete"
      FROM pg_constraint c
      JOIN pg_class target ON target.oid = c.confrelid
      JOIN pg_attribute a ON a.attrelid = c.conrelid
        AND a.attnum = c.conkey[1]
      WHERE c.conrelid = to_regclass('billing_events') AND c.contype = 'f'
    `,
    prisma.$queryRaw`
      SELECT enumlabel FROM pg_enum
      WHERE enumtypid = to_regtype('"BillingEventStatus"')
      ORDER BY enumsortorder
    `,
  ]);

  let missing = 0;
  function check(label, condition) {
    console.log(`${condition ? '[OK]' : '[BRAK]'} ${label}`);
    if (!condition) missing += 1;
  }

  console.log(`Audyt migracji ${migrationName} (tylko odczyt):`);
  check('Typ BillingEventStatus', catalog[0].enumExists);
  check('Tabela billing_events', catalog[0].tableExists);
  const actualEnum = enumValues.map((row) => row.enumlabel);
  check('Wartosci statusu', JSON.stringify(actualEnum) === JSON.stringify([
    'unpriced', 'pending', 'excluded', 'invoiced',
  ]));

  const actualColumns = new Map(columns.map((row) => [row.name, row]));
  for (const name of expectedColumns) {
    const column = actualColumns.get(name);
    check(`Kolumna ${name}`, column?.type === expectedTypes[name]
      && column.required === !nullableColumns.has(name));
  }

  const actualIndexes = new Map(indexes.map((row) => [row.name, row]));
  for (const name of expectedIndexes) {
    const index = actualIndexes.get(name);
    const expectedUnique = name.endsWith('_key') || name === 'billing_events_pkey';
    check(`Indeks ${name}`, index?.unique === expectedUnique
      && JSON.stringify(index?.columns) === JSON.stringify(expectedIndexColumns[name]));
  }

  const actualForeignKeys = new Map(foreignKeys.map((row) => [row.name, row]));
  for (const name of expectedForeignKeys) {
    const key = actualForeignKeys.get(name);
    const [column, target, onDelete] = expectedForeignKeyTargets[name];
    check(`Relacja ${name}`, key?.column === column && key?.target === target
      && key?.onDelete === onDelete);
  }

  const latest = history[0];
  const status = !latest ? 'brak wpisu'
    : latest.finished_at ? 'zastosowana'
    : latest.rolled_back_at ? 'wycofana'
    : 'nieudana / w toku';
  console.log(`Historia Prisma: ${status}`);
  console.log('Dane nie zostaly zmienione.');
  if (missing > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error('Audyt migracji nie powiodl sie:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
