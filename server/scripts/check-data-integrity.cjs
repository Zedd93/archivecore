const path = require('path');
const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const prisma = new PrismaClient();

const checks = [
  {
    name: 'Pozycje spisu bez teczki',
    sql: `
      SELECT COUNT(*)::int AS count
      FROM "transfer_list_items" item
      LEFT JOIN "folders" folder ON folder."id" = item."folderId"
      WHERE folder."id" IS NULL
    `,
  },
  {
    name: 'Teczki przypisane do innego tenanta niż spis',
    sql: `
      SELECT COUNT(*)::int AS count
      FROM "transfer_list_items" item
      JOIN "folders" folder ON folder."id" = item."folderId"
      JOIN "transfer_lists" list ON list."id" = item."transferListId"
      WHERE folder."tenantId" IS DISTINCT FROM list."tenantId"
    `,
  },
  {
    name: 'Rozbieżne przypisanie kartonu',
    sql: `
      SELECT COUNT(*)::int AS count
      FROM "transfer_list_items" item
      JOIN "folders" folder ON folder."id" = item."folderId"
      WHERE folder."boxId" IS DISTINCT FROM item."boxId"
    `,
  },
  {
    name: 'Rozbieżne dane teczki i pozycji spisu',
    sql: `
      SELECT COUNT(*)::int AS count
      FROM "transfer_list_items" item
      JOIN "folders" folder ON folder."id" = item."folderId"
      WHERE folder."folderNumber" IS DISTINCT FROM item."folderSignature"
         OR folder."title" IS DISTINCT FROM item."folderTitle"
         OR folder."dateFrom" IS DISTINCT FROM item."dateFrom"
         OR folder."dateTo" IS DISTINCT FROM item."dateTo"
         OR folder."description" IS DISTINCT FROM item."notes"
    `,
  },
  {
    name: 'Zlecenia wskazujące inną teczkę niż pozycja spisu',
    sql: `
      SELECT COUNT(*)::int AS count
      FROM "order_items" order_item
      JOIN "transfer_list_items" item ON item."id" = order_item."transferListItemId"
      WHERE order_item."folderId" IS DISTINCT FROM item."folderId"
    `,
  },
];

async function main() {
  let issueCount = 0;
  console.log('Kontrola spójności pozycji spisów ZO i teczek:');

  for (const check of checks) {
    const rows = await prisma.$queryRawUnsafe(check.sql);
    const count = Number(rows[0]?.count || 0);
    issueCount += count;
    console.log(`${count === 0 ? '[OK]' : '[BŁĄD]'} ${check.name}: ${count}`);
  }

  if (issueCount > 0) {
    console.error(`\nWykryto łącznie ${issueCount} niespójnych rekordów. Dane nie zostały zmienione.`);
    process.exitCode = 1;
    return;
  }

  console.log('\nNie wykryto niespójności.');
}

main()
  .catch((error) => {
    console.error('Kontrola spójności nie powiodła się:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
