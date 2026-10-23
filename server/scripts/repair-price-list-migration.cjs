const path = require('path');
const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const prisma = new PrismaClient();
const migrationName = '20261008090000_add_tenant_price_lists';

async function inspect(db) {
  const [history, indexes, duplicates, roles] = await Promise.all([
    db.$queryRaw`
      SELECT finished_at, rolled_back_at
      FROM "_prisma_migrations"
      WHERE migration_name = ${migrationName}
      ORDER BY started_at DESC
      LIMIT 1
    `,
    db.$queryRaw`
      SELECT COUNT(*)::int AS count
      FROM pg_class index_class
      JOIN pg_namespace namespace ON namespace.oid = index_class.relnamespace
      WHERE namespace.nspname = current_schema()
        AND index_class.relname = 'price_lists_one_active_per_tenant_idx'
    `,
    db.$queryRaw`
      SELECT "tenantId"
      FROM "price_lists"
      WHERE "status" = 'active'
      GROUP BY "tenantId"
      HAVING COUNT(*) > 1
      LIMIT 1
    `,
    db.$queryRaw`
      SELECT id, "permissions"::jsonb ? 'pricing.manage' AS granted
      FROM "roles"
      WHERE "code" = 'DA' AND "tenantId" IS NULL AND "isSystem" = true
    `,
  ]);

  if (!history[0] || history[0].finished_at || history[0].rolled_back_at) {
    throw new Error(`Migracja ${migrationName} nie jest w stanie nieudanym. Sprawdz historie Prisma.`);
  }
  if (Number(indexes[0].count) !== 0) {
    throw new Error('Indeks o docelowej nazwie juz istnieje. Sprawdz jego definicje przed naprawa.');
  }
  if (duplicates.length > 0) {
    throw new Error('Tenant ma wiecej niz jeden aktywny cennik. Nie mozna dodac unikalnego indeksu.');
  }
  if (roles.length !== 1) {
    throw new Error(`Oczekiwano jednej systemowej roli DA, znaleziono ${roles.length}.`);
  }

  return { roleId: roles[0].id, permissionAlreadyGranted: roles[0].granted };
}

async function main() {
  if (process.argv.slice(2).some((arg) => arg !== '--apply')) {
    throw new Error('Dozwolona opcja: --apply');
  }
  const apply = process.argv.includes('--apply');
  const plan = await inspect(prisma);
  console.log(`Migracja ${migrationName}: warunki naprawy spelnione.`);
  console.log(`Brakujacy indeks: tak; uprawnienie DA: ${plan.permissionAlreadyGranted ? 'juz nadane' : 'do nadania'}.`);
  if (!apply) {
    console.log('Podglad: dane nie zostaly zmienione. Uzyj --apply po zatwierdzeniu.');
    return;
  }

  await prisma.$transaction(async (tx) => {
    const current = await inspect(tx);
    await tx.$executeRawUnsafe(`
      CREATE UNIQUE INDEX "price_lists_one_active_per_tenant_idx"
      ON "price_lists"("tenantId") WHERE "status" = 'active'
    `);
    await tx.$executeRaw`
      UPDATE "roles"
      SET "permissions" = "permissions"::jsonb || '["pricing.manage"]'::jsonb
      WHERE id = ${current.roleId}::uuid
        AND NOT ("permissions"::jsonb ? 'pricing.manage')
    `;
  }, { maxWait: 10_000, timeout: 120_000 });

  console.log('Dodano indeks i uzupelniono uprawnienie DA w jednej transakcji.');
  console.log('Uruchom audyt, a potem osobno oznacz te migracje jako zastosowana w Prisma.');
}

main()
  .catch((error) => {
    console.error('Naprawa migracji nie powiodla sie:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
