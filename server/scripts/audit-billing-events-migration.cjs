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
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'billing_events'
    `,
    prisma.$queryRaw`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = current_schema() AND tablename = 'billing_events'
    `,
    prisma.$queryRaw`
      SELECT conname FROM pg_constraint
      WHERE conrelid = to_regclass('billing_events') AND contype = 'f'
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

  const columnNames = new Set(columns.map((row) => row.column_name));
  for (const name of expectedColumns) check(`Kolumna ${name}`, columnNames.has(name));

  const indexNames = new Set(indexes.map((row) => row.indexname));
  for (const name of expectedIndexes) check(`Indeks ${name}`, indexNames.has(name));

  const constraintNames = new Set(foreignKeys.map((row) => row.conname));
  for (const name of expectedForeignKeys) check(`Relacja ${name}`, constraintNames.has(name));

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
