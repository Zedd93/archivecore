const path = require('path');

function classifyBoxLoanStatus(row) {
  if (row.status === 'active') return Number(row.activeWholeLoans) > 0 ? 'active_with_whole_box_loan' : 'consistent_active';
  if (Number(row.activeWholeLoans) > 0) return 'whole_box_loan';
  if (Number(row.activePartialLoans) > 0) return 'active_partial_loan';
  if (Number(row.historicalPartialLoans) > 0) return 'past_partial_loan';
  return 'no_loan_evidence';
}

async function auditBoxLoanStatus(prisma) {
  const checkedOutRows = await prisma.$queryRaw`
    SELECT b."id", b."boxNumber", b."status"::text, t."shortCode",
      (
        SELECT COUNT(*)::int
        FROM "order_items" oi
        JOIN "orders" o ON o."id" = oi."orderId"
        WHERE oi."boxId" = b."id"
          AND o."tenantId" = b."tenantId"
          AND o."orderType" = 'checkout'
          AND o."status" IN ('delivered', 'completed')
          AND oi."itemStatus" = 'delivered'
      ) AS "activeWholeLoans",
      partial."activePartialLoans",
      partial."historicalPartialLoans"
    FROM "boxes" b
    JOIN "tenants" t ON t."id" = b."tenantId"
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) FILTER (
          WHERE o."status" IN ('delivered', 'completed')
            AND oi."itemStatus" = 'delivered'
        )::int AS "activePartialLoans",
        COUNT(*) FILTER (WHERE oi."deliveredAt" IS NOT NULL)::int AS "historicalPartialLoans"
      FROM "order_items" oi
      JOIN "orders" o ON o."id" = oi."orderId"
      LEFT JOIN "folders" f ON f."id" = oi."folderId"
      LEFT JOIN "documents" d ON d."id" = oi."documentId"
      LEFT JOIN "folders" df ON df."id" = d."folderId"
      LEFT JOIN "transfer_list_items" li ON li."id" = oi."transferListItemId"
      LEFT JOIN "folders" lf ON lf."id" = li."folderId"
      LEFT JOIN "hr_folders" hr ON hr."id" = oi."hrFolderId"
      WHERE oi."boxId" IS NULL
        AND o."tenantId" = b."tenantId"
        AND o."orderType" = 'checkout'
        AND COALESCE(f."boxId", d."boxId", df."boxId", li."boxId", lf."boxId", hr."boxId") = b."id"
    ) partial ON true
    WHERE b."status" = 'checked_out'
      AND b."deletedAt" IS NULL
    ORDER BY t."shortCode", b."boxNumber", b."id"
  `;
  const activeRows = await prisma.$queryRaw`
    SELECT b."id", b."boxNumber", b."status"::text, t."shortCode",
      COUNT(*)::int AS "activeWholeLoans",
      0::int AS "activePartialLoans",
      0::int AS "historicalPartialLoans"
    FROM "boxes" b
    JOIN "tenants" t ON t."id" = b."tenantId"
    JOIN "order_items" oi ON oi."boxId" = b."id"
    JOIN "orders" o ON o."id" = oi."orderId" AND o."tenantId" = b."tenantId"
    WHERE b."status" = 'active'
      AND b."deletedAt" IS NULL
      AND o."orderType" = 'checkout'
      AND o."status" IN ('delivered', 'completed')
      AND oi."itemStatus" = 'delivered'
    GROUP BY b."id", b."boxNumber", b."status", t."shortCode"
    ORDER BY t."shortCode", b."boxNumber", b."id"
  `;

  return [...checkedOutRows, ...activeRows].map((row) => ({ ...row, classification: classifyBoxLoanStatus(row) }));
}

function printReport(rows, showAll = false) {
  const labels = {
    active_partial_loan: 'wydany, wypożyczona część zawartości',
    past_partial_loan: 'wydany, historyczne wypożyczenie części',
    no_loan_evidence: 'wydany, brak śladu wypożyczenia',
    active_with_whole_box_loan: 'aktywny, wypożyczony cały karton',
  };
  const counts = rows.reduce((result, row) => {
    result[row.classification] = (result[row.classification] || 0) + 1;
    return result;
  }, {});
  const candidates = rows.filter((row) => !['whole_box_loan', 'consistent_active'].includes(row.classification));

  console.log('Kontrola zgodności statusów kartonów i wypożyczeń:');
  console.log(`Wydane całe kartony z aktywnym wypożyczeniem: ${counts.whole_box_loan || 0}`);
  console.log(`Do weryfikacji, aktywne wypożyczenie części zawartości: ${counts.active_partial_loan || 0}`);
  console.log(`Do weryfikacji, tylko historyczne wypożyczenie części zawartości: ${counts.past_partial_loan || 0}`);
  console.log(`Do weryfikacji, bez śladu wypożyczenia: ${counts.no_loan_evidence || 0}`);
  console.log(`Do weryfikacji, aktywny karton z wydanym całym kartonem: ${counts.active_with_whole_box_loan || 0}`);

  if (candidates.length > 0) {
    const visible = showAll ? candidates : candidates.slice(0, 100);
    console.table(visible.map((row) => ({
      Tenant: row.shortCode,
      Karton: row.boxNumber,
      ID: row.id,
      Status: row.status,
      Powód: labels[row.classification],
      'Aktywne części': row.activePartialLoans,
      'Historyczne części': row.historicalPartialLoans,
    })));
    if (!showAll && candidates.length > visible.length) {
      console.log(`Pokazano ${visible.length} z ${candidates.length}. Użyj --all, aby wyświetlić wszystkie.`);
    }
  }

  console.log('Dane nie zostały zmienione. Przed korektą każdego kartonu sprawdź ręczne zmiany statusu i historię wydań.');
}

async function main() {
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const rows = await auditBoxLoanStatus(prisma);
    printReport(rows, process.argv.includes('--all'));
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Kontrola statusów kartonów nie powiodła się:', error);
    process.exitCode = 1;
  });
}

module.exports = { auditBoxLoanStatus, classifyBoxLoanStatus, printReport };
