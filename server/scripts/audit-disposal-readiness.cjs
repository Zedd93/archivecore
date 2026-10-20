const path = require('node:path');

const ISSUE_LABELS = {
  orphan: 'Teczki w kartonie bez pozycji spisu ZO',
  noBasis: 'Teczki bez polityki JRWA i pozycji spisu',
  missingYears: 'Polityki bez poprawnego okresu retencji',
  unsupportedTrigger: 'Polityki wymagajace recznego ustalenia daty bazowej',
  missingEndDate: 'Teczki bez daty koncowej potrzebnej do retencji',
  unknownCategory: 'Pozycje spisu z niejednoznaczna kategoria',
};

async function auditDisposalReadiness(db, { pageSize = 500, exampleLimit = 10 } = {}) {
  const report = {
    checked: 0,
    protected: 0,
    issues: Object.fromEntries(Object.keys(ISSUE_LABELS).map((key) => [key, 0])),
    byTenant: {},
    examples: [],
  };
  let cursor;
  for (;;) {
    const rows = await db.folder.findMany({
      where: { status: { not: 'disposed' }, box: { is: { deletedAt: null, status: { not: 'disposed' } } } },
      select: {
        id: true,
        dateTo: true,
        tenant: { select: { shortCode: true } },
        box: { select: { id: true, boxNumber: true } },
        retentionPolicy: { select: {
          retentionTrigger: true, retentionYears: true, isPermanent: true, archivalCategory: true,
        } },
        transferListItem: { select: { categoryCode: true, dateTo: true } },
      },
      orderBy: { id: 'asc' },
      take: pageSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    for (const row of rows) {
      report.checked++;
      const tenant = row.tenant.shortCode;
      const tenantIssues = report.byTenant[tenant] ??= Object.fromEntries(Object.keys(ISSUE_LABELS).map((key) => [key, 0]));
      const policy = row.retentionPolicy;
      const item = row.transferListItem;
      const category = item?.categoryCode?.trim() ?? '';
      const protectedFolder = Boolean(policy?.isPermanent || /^(A|BE)/i.test(policy?.archivalCategory ?? '') || /^(A|BE)/i.test(category));
      if (protectedFolder) report.protected++;

      const issues = [];
      if (!item) issues.push('orphan');
      if (!policy && !item) issues.push('noBasis');
      if (policy && !protectedFolder) {
        if (!Number.isSafeInteger(policy.retentionYears) || policy.retentionYears < 0) issues.push('missingYears');
        if (!['creation_date', 'end_date'].includes(policy.retentionTrigger)) issues.push('unsupportedTrigger');
        if (policy.retentionTrigger === 'end_date' && !row.dateTo) issues.push('missingEndDate');
      }
      if (item && !protectedFolder) {
        if (!/^B\d+$/i.test(category)) issues.push('unknownCategory');
        else if (!item.dateTo && !row.dateTo && !issues.includes('missingEndDate')) issues.push('missingEndDate');
      }
      for (const issue of issues) {
        report.issues[issue]++;
        tenantIssues[issue]++;
        if (report.examples.filter((example) => example.issue === issue).length < exampleLimit) {
          report.examples.push({ issue, tenant, boxNumber: row.box.boxNumber, folderId: row.id });
        }
      }
    }
    if (rows.length < pageSize) break;
    cursor = rows[rows.length - 1].id;
  }
  return report;
}

function printReport(report) {
  console.log('Audyt gotowosci teczek do brakowania (tylko odczyt):');
  console.log(`Sprawdzone teczki w aktywnych kartonach: ${report.checked}`);
  console.log(`Chronione kategoria A/BE lub trwala retencja: ${report.protected}`);
  for (const [key, label] of Object.entries(ISSUE_LABELS)) console.log(`${label}: ${report.issues[key]}`);
  if (Object.keys(report.byTenant).length) {
    console.log('Wyniki wedlug tenantow:');
    console.table(Object.entries(report.byTenant).map(([tenant, issues]) => ({ tenant, ...issues })));
  }
  if (report.examples.length) {
    console.log('Przykladowe identyfikatory do weryfikacji:');
    console.table(report.examples);
  }
  console.log('Dane nie zostaly zmienione. Nie koryguj rekordow bez sprawdzenia dokumentacji zrodlowej.');
}

async function main() {
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient();
  try {
    const report = await auditDisposalReadiness(db);
    printReport(report);
    if (Object.values(report.issues).some((count) => count > 0)) process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    const code = typeof error?.code === 'string' && /^[A-Z0-9_]{1,32}$/.test(error.code) ? error.code : 'UNKNOWN';
    console.error(`Audyt gotowosci do brakowania nie powiodl sie: ${code}`);
    process.exitCode = 1;
  });
}

module.exports = { auditDisposalReadiness, printReport };
