const path = require('path');
const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const prisma = new PrismaClient();
const migrationName = '20261009170000_add_disposal_approval_stage';

async function main() {
  const [history, statuses, roles] = await Promise.all([
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
      WHERE n.nspname = 'public' AND t.typname = 'BoxStatus'
    `,
    prisma.$queryRaw`
      SELECT code, "isSystem", permissions
      FROM roles
      WHERE code IN ('TL', 'DA') AND "isSystem" = true
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
  check('Status BoxStatus.approved_disposal', statuses.some((row) => row.value === 'approved_disposal'));

  for (const [code, permission] of [['TL', 'disposal.approve'], ['DA', 'disposal.complete']]) {
    const matchingRoles = roles.filter((role) => role.code === code);
    check(`Rola systemowa ${code}`, matchingRoles.length === 1, `liczba: ${matchingRoles.length}`);
    if (matchingRoles.length === 1) {
      const permissions = matchingRoles[0].permissions;
      check(`Uprawnienie ${code}: ${permission}`, Array.isArray(permissions)
        && permissions.includes(permission), Array.isArray(permissions) ? 'brak uprawnienia' : 'niepoprawna lista');
    }
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
