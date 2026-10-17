const path = require('path');
const { calculateHRRetention } = require('../dist/modules/hr/hr-retention.js');

function dateKey(value) {
  return value ? new Date(value).toISOString().slice(0, 10) : null;
}

async function auditHRRetention(db, { now = new Date(), pageSize = 500 } = {}) {
  const report = {
    total: 0, needsReview: 0, mismatches: 0, futureRia: 0, hiddenLegacyDates: 0,
    examples: [],
  };
  let cursor;
  for (;;) {
    const rows = await db.hRFolder.findMany({
      select: {
        id: true, employmentStart: true, employmentEnd: true,
        riaStatus: true, riaSubmittedAt: true, retentionReviewRequired: true,
        retentionBasis: true, retentionPeriod: true,
        retentionBaseDate: true, retentionEndDate: true,
        tenant: { select: { shortCode: true } },
      },
      orderBy: { id: 'asc' },
      take: pageSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    for (const row of rows) {
      report.total++;
      if (row.retentionBasis === 'needs_review') report.needsReview++;
      if (row.retentionBasis === 'needs_review' && row.retentionEndDate) report.hiddenLegacyDates++;
      const futureRia = row.riaSubmittedAt && dateKey(row.riaSubmittedAt) > dateKey(now);
      if (futureRia) report.futureRia++;

      const expected = calculateHRRetention(row, now);
      const differingFields = row.retentionBasis === 'needs_review' && expected.retentionBasis === 'needs_review'
        ? []
        : ['retentionBasis', 'retentionPeriod', 'retentionBaseDate', 'retentionEndDate']
          .filter((field) => (field.endsWith('Date') ? dateKey(row[field]) !== dateKey(expected[field])
            : row[field] !== expected[field]));
      if (differingFields.length) {
        report.mismatches++;
        if (report.examples.length < 20) {
          report.examples.push({ tenant: row.tenant.shortCode, id: row.id, fields: differingFields.join(', ') });
        }
      }
    }
    if (rows.length < pageSize) break;
    cursor = rows[rows.length - 1].id;
  }
  return report;
}

function printReport(report) {
  console.log('Kontrola okresow przechowywania akt osobowych (tylko odczyt):');
  console.log(`Sprawdzone teczki: ${report.total}`);
  console.log(`Wymagaja weryfikacji: ${report.needsReview}`);
  console.log(`Rozbieznosci z aktualnym wyliczeniem: ${report.mismatches}`);
  console.log(`Przyszle daty zlozenia ZUS RIA: ${report.futureRia}`);
  console.log(`Ukryte starsze daty przy statusie weryfikacji: ${report.hiddenLegacyDates}`);
  if (report.examples.length) console.table(report.examples);
  console.log('Dane nie zostaly zmienione. Rozbieznosci wymagaja recznego sprawdzenia przed korekta.');
}

async function main() {
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient();
  try {
    const report = await auditHRRetention(db);
    printReport(report);
    if (report.mismatches || report.futureRia) process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    const code = typeof error?.code === 'string' && /^[A-Z0-9_]{1,32}$/.test(error.code) ? error.code : 'UNKNOWN';
    console.error(`Kontrola retencji nie powiodla sie: ${code}`);
    process.exitCode = 1;
  });
}

module.exports = { auditHRRetention, printReport };
