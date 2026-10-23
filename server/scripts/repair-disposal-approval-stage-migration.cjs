const path = require('path');
const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const prisma = new PrismaClient();
const requiredPermissions = [
  ['TL', 'disposal.approve'],
  ['DA', 'disposal.complete'],
];

async function main() {
  const [statuses, roles] = await Promise.all([
    prisma.$queryRaw`
      SELECT e.enumlabel AS value
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public' AND t.typname = 'BoxStatus'
    `,
    prisma.$queryRaw`
      SELECT id, code, permissions
      FROM roles
      WHERE code IN ('TL', 'DA') AND "isSystem" = true
    `,
  ]);

  if (!statuses.some((row) => row.value === 'approved_disposal')) {
    throw new Error('Brak statusu approved_disposal; najpierw uzgodnij typ BoxStatus');
  }

  const missing = [];
  for (const [code, permission] of requiredPermissions) {
    const matchingRoles = roles.filter((role) => role.code === code);
    if (matchingRoles.length !== 1 || !Array.isArray(matchingRoles[0].permissions)) {
      throw new Error(`Oczekiwano dokladnie jednej roli systemowej ${code} z lista uprawnien`);
    }
    if (!matchingRoles[0].permissions.includes(permission)) {
      missing.push({ id: matchingRoles[0].id, code, permission });
    }
  }

  console.log(`Do uzupelnienia: ${missing.map(({ code, permission }) => `${code}: ${permission}`).join(', ') || 'brak'}`);
  if (!process.argv.includes('--apply')) {
    console.log('Podglad: role nie zostaly zmienione. Uzyj --apply po zatwierdzeniu zakresu.');
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const { id, code, permission } of missing) {
      const changed = await tx.$executeRaw`
        UPDATE roles
        SET permissions = permissions || jsonb_build_array(${permission})
        WHERE id = ${id}::uuid AND code = ${code} AND "isSystem" = true
          AND jsonb_typeof(permissions) = 'array'
          AND NOT (permissions @> jsonb_build_array(${permission}))
      `;
      if (changed !== 1) throw new Error(`Rola ${code} zmienila sie podczas naprawy; transakcja wycofana`);
    }
  });
  console.log(`Uzupelniono ${missing.length} role systemowe. Pozostale dane nie zostaly zmienione.`);
}

main()
  .catch((error) => {
    console.error('Naprawa nie powiodla sie:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
