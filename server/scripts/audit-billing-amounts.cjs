const path = require('path');

async function auditBillingAmounts(db) {
  return db.$queryRaw`
    SELECT e."id", t."shortCode", e."serviceCode", e."sourceType",
      e."quantity", e."unitPrice", e."netAmount",
      ROUND(e."quantity" * e."unitPrice", 2) AS "expectedNetAmount",
      e."status"::text AS "status", e."billingPeriod",
      (e."netAmount" = e."unitPrice") AS "unitOnly"
    FROM "billing_events" e
    JOIN "tenants" t ON t."id" = e."tenantId"
    WHERE e."quantity" <> 1
      AND e."unitPrice" IS NOT NULL
      AND e."netAmount" IS NOT NULL
      AND e."netAmount" <> ROUND(e."quantity" * e."unitPrice", 2)
    ORDER BY e."billingPeriod" DESC, t."shortCode", e."id"
  `;
}

function printReport(rows, showAll = false) {
  const billed = rows.filter((row) => row.status === 'invoiced').length;
  const unitOnly = rows.filter((row) => row.unitOnly).length;
  console.log('Kontrola kwot pozycji rozliczeniowych (tylko odczyt):');
  console.log(`Pozycje wymagające weryfikacji: ${rows.length}`);
  console.log(`Z tego zafakturowane: ${billed}`);
  console.log(`Z kwotą równą samej stawce jednostkowej: ${unitOnly}`);

  const visible = showAll ? rows : rows.slice(0, 100);
  if (visible.length > 0) {
    console.table(visible.map((row) => ({
      Tenant: row.shortCode,
      ID: row.id,
      Usługa: row.serviceCode,
      Źródło: row.sourceType,
      Okres: row.billingPeriod.toISOString().slice(0, 7),
      Status: row.status,
      Ilość: row.quantity.toString(),
      Stawka: row.unitPrice.toString(),
      'Kwota zapisana': row.netAmount.toString(),
      'Kwota obliczona': row.expectedNetAmount.toString(),
    })));
    if (!showAll && rows.length > visible.length) {
      console.log(`Pokazano ${visible.length} z ${rows.length}. Użyj --all, aby wyświetlić wszystkie.`);
    }
  }
  console.log('Dane nie zostały zmienione. Pozycje zafakturowane wymagają osobnej decyzji rozliczeniowej.');
}

async function main() {
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient();
  try {
    printReport(await auditBillingAmounts(db), process.argv.includes('--all'));
  } finally {
    await db.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Kontrola kwot rozliczeniowych nie powiodła się:', error);
    process.exitCode = 1;
  });
}

module.exports = { auditBillingAmounts, printReport };
