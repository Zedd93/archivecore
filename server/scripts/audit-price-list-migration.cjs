const path = require('path');
const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const prisma = new PrismaClient();
const migrationName = '20261008090000_add_tenant_price_lists';

async function main() {
  const [history, objects, roles, conflictingActiveLists] = await Promise.all([
    prisma.$queryRaw`
      SELECT migration_name, finished_at, rolled_back_at
      FROM "_prisma_migrations"
      WHERE migration_name = ${migrationName}
      ORDER BY started_at DESC
    `,
    prisma.$queryRaw`
      SELECT
        to_regtype('"PriceListStatus"') IS NOT NULL AS "priceListStatus",
        to_regclass('price_lists') IS NOT NULL AS "priceLists",
        to_regclass('price_list_items') IS NOT NULL AS "priceListItems",
        EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE schemaname = current_schema()
            AND indexname = 'price_lists_tenantId_status_idx'
        ) AS "statusIndex",
        EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE schemaname = current_schema()
            AND indexname = 'price_lists_tenantId_validFrom_idx'
        ) AS "validFromIndex",
        EXISTS (
          SELECT 1 FROM pg_index i
          JOIN pg_class index_class ON index_class.oid = i.indexrelid
          JOIN pg_namespace namespace ON namespace.oid = index_class.relnamespace
          WHERE namespace.nspname = current_schema()
            AND index_class.relname = 'price_lists_one_active_per_tenant_idx'
            AND i.indisunique AND i.indpred IS NOT NULL
        ) AS "oneActiveIndex",
        EXISTS (
          SELECT 1 FROM pg_index i
          JOIN pg_class index_class ON index_class.oid = i.indexrelid
          JOIN pg_namespace namespace ON namespace.oid = index_class.relnamespace
          WHERE namespace.nspname = current_schema()
            AND index_class.relname = 'price_list_items_priceListId_serviceCode_key'
            AND i.indisunique
        ) AS "itemUniqueIndex",
        EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE schemaname = current_schema()
            AND indexname = 'price_list_items_serviceCode_idx'
        ) AS "serviceCodeIndex",
        EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'price_lists_tenantId_fkey' AND contype = 'f'
        ) AS "tenantForeignKey",
        EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'price_list_items_priceListId_fkey' AND contype = 'f'
        ) AS "itemsForeignKey"
    `,
    prisma.$queryRaw`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE "permissions"::jsonb ? 'pricing.manage')::int AS granted
      FROM "roles"
      WHERE "code" = 'DA' AND "tenantId" IS NULL
    `,
    prisma.$queryRaw`
      SELECT "tenantId", COUNT(*)::int AS count
      FROM "price_lists"
      WHERE "status" = 'active'
      GROUP BY "tenantId"
      HAVING COUNT(*) > 1
      LIMIT 20
    `,
  ]);

  const labels = {
    priceListStatus: 'Typ PriceListStatus',
    priceLists: 'Tabela price_lists',
    priceListItems: 'Tabela price_list_items',
    statusIndex: 'Indeks statusu cennika',
    validFromIndex: 'Indeks daty waznosci cennika',
    oneActiveIndex: 'Unikalny indeks aktywnego cennika',
    itemUniqueIndex: 'Unikalny indeks pozycji cennika',
    serviceCodeIndex: 'Indeks kodu uslugi',
    tenantForeignKey: 'Relacja cennika z tenantem',
    itemsForeignKey: 'Relacja pozycji z cennikiem',
  };
  const state = objects[0];
  let missing = 0;

  console.log(`Audyt migracji ${migrationName} (tylko odczyt):`);
  for (const [key, label] of Object.entries(labels)) {
    const exists = state[key] === true;
    if (!exists) missing += 1;
    console.log(`${exists ? '[OK]' : '[BRAK]'} ${label}`);
  }

  const roleCount = Number(roles[0].total);
  const grantedCount = Number(roles[0].granted);
  if (roleCount > grantedCount) missing += roleCount - grantedCount;
  console.log(`Uprawnienie pricing.manage dla roli DA: ${grantedCount}/${roleCount}`);
  console.log(`Tenanci z wieloma aktywnymi cennikami: ${conflictingActiveLists.length}${conflictingActiveLists.length === 20 ? ' (pierwsze 20)' : ''}`);
  if (conflictingActiveLists.length > 0) missing += conflictingActiveLists.length;

  const latest = history[0];
  const status = !latest ? 'brak wpisu'
    : latest.finished_at ? 'zastosowana'
    : latest.rolled_back_at ? 'wycofana'
    : 'nieudana / w toku';
  console.log(`Historia Prisma: ${status}`);
  console.log('Dane nie zostaly zmienione.');

  if (missing > 0 || status !== 'zastosowana') {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error('Audyt migracji nie powiodl sie:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
