import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseReportYear, getAnnualReport, buildAnnualReportPdf } = require('../dist/modules/reports/annual-report.service.js');

const now = new Date('2026-10-19T12:00:00Z');

function mockDb(empty = false) {
  const calls = [];
  const record = (model, method, result) => async (args) => {
    calls.push({ model, method, args });
    return result;
  };
  const db = {
    $transaction: async (run, options) => {
      assert.equal(options.isolationLevel, 'RepeatableRead');
      return run(db);
    },
    tenant: { findUnique: record('tenant', 'findUnique', { name: 'Spółdzielnia Łódź' }) },
    $queryRaw: record('ledger', '$queryRaw', empty ? [] : [
      { month: 1, acquisitions: 2n, disposals: 0n },
      { month: 10, acquisitions: 0n, disposals: 1n },
    ]),
    folder: { count: record('folder', 'count', empty ? 0 : 7) },
    hRFolder: { count: record('hRFolder', 'count', empty ? 0 : 3) },
    order: {
      groupBy: record('order', 'groupBy', empty ? [] : [{ orderType: 'checkout', _count: 4 }]),
      count: record('order', 'count', empty ? 0 : 2),
    },
    inventorySession: { count: record('inventorySession', 'count', empty ? 0 : 1) },
    box: { count: record('box', 'count', empty ? 0 : 12) },
  };
  return { calls, db };
}

test('annual report accepts only years up to the current year', () => {
  assert.equal(parseReportYear('2025', now), 2025);
  assert.equal(parseReportYear('2026', new Date('2025-12-31T23:30:00Z')), 2026);
  for (const value of ['1999', '2027', '2026x', '26', undefined, ['2026']]) {
    assert.equal(parseReportYear(value, now), null);
  }
});

test('annual figures are tenant-scoped, derived from the ledger and separated from current holdings', async () => {
  const { db, calls } = mockDb();
  const report = await getAnnualReport('11111111-1111-1111-1111-111111111111', 2026, db, now);
  assert.equal(report.ledger.acquisitions, 2);
  assert.equal(report.ledger.disposals, 1);
  assert.equal(report.ledger.months.length, 12);
  assert.deepEqual(report.ledger.months[1], { month: 2, acquisitions: 0, disposals: 0 });
  assert.equal(report.activity.createdOrders[0].count, 4);
  assert.equal(report.current.boxes, 12);
  assert.equal(report.activity.inventorySessions, 1);
  assert.equal(calls.every(({ model, args }) => model === 'ledger' || args.where.tenantId === '11111111-1111-1111-1111-111111111111' || args.where.id === '11111111-1111-1111-1111-111111111111'), true);
  const ledgerQuery = calls.find(({ model }) => model === 'ledger').args;
  assert.match(ledgerQuery.sql, /disposal\.batch_completed/);
  assert.match(ledgerQuery.sql, /box\.create/);
  assert.match(ledgerQuery.sql, /receipt/);
  assert.equal(ledgerQuery.values.filter((value) => value === '11111111-1111-1111-1111-111111111111').length, 3);
  const range = calls.find(({ model, method }) => model === 'order' && method === 'groupBy').args.where.createdAt;
  assert.equal(range.gte.toISOString(), '2025-12-31T23:00:00.000Z');
  assert.equal(range.lt.toISOString(), '2026-12-31T23:00:00.000Z');
  const pdf = await buildAnnualReportPdf(report);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.length > 5000);
  if (process.env.ANNUAL_REPORT_PDF_PREVIEW) fs.writeFileSync(process.env.ANNUAL_REPORT_PDF_PREVIEW, pdf);
});

test('empty year still produces 12 zero-filled months and a readable PDF', async () => {
  const { db } = mockDb(true);
  const report = await getAnnualReport('11111111-1111-1111-1111-111111111111', 2025, db, now);
  assert.equal(report.ledger.months.length, 12);
  assert.equal(report.ledger.acquisitions, 0);
  assert.equal(report.activity.createdOrders.length, 0);
  const pdf = await buildAnnualReportPdf(report);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
});
