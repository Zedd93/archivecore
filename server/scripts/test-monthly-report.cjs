const test = require('node:test');
const assert = require('node:assert/strict');
const { parseReportMonth, getMonthlyReport, buildMonthlyReportPdf } = require('../dist/modules/reports/monthly-report.service');

const now = new Date('2026-10-09T10:00:00Z');

test('accepts only valid past or current UTC months', () => {
  assert.deepEqual(parseReportMonth('2026-09', now), {
    month: '2026-09',
    start: new Date('2026-09-01T00:00:00Z'),
    end: new Date('2026-10-01T00:00:00Z'),
  });
  for (const value of ['2026-13', '2026-00', '2026-11', '1999-12', '2026-9', undefined, ['2026-09']]) {
    assert.equal(parseReportMonth(value, now), null);
  }
});

function database() {
  const calls = [];
  const record = (model, method, result) => async (args) => {
    calls.push({ model, method, args });
    return result;
  };
  const db = {
    tenant: { findUnique: record('tenant', 'findUnique', { name: 'Spółdzielnia Łódź' }) },
    box: { count: record('box', 'count', 7) },
    folder: { count: record('folder', 'count', 12) },
    order: {
      groupBy: record('order', 'groupBy', [{ orderType: 'checkout', _count: 3 }]),
      count: record('order', 'count', 2),
      findMany: record('order', 'findMany', [
        { completedAt: new Date('2026-09-15T10:00:00Z'), slaDeadline: new Date('2026-09-15T12:00:00Z') },
        { completedAt: new Date('2026-09-20T10:00:00Z'), slaDeadline: new Date('2026-09-19T12:00:00Z') },
      ]),
    },
    hRFolder: { count: record('hRFolder', 'count', 4) },
    billingEvent: { groupBy: record('billingEvent', 'groupBy', [
      { status: 'pending', currency: 'PLN', _count: 2, _sum: { netAmount: { toFixed: () => '125.50' } } },
      { status: 'unpriced', currency: 'PLN', _count: 1, _sum: { netAmount: null } },
    ]) },
  };
  return { db, calls };
}

test('scopes every query to tenant and period and omits billing without permission', async () => {
  const { db, calls } = database();
  const report = await getMonthlyReport('tenant-1', '2026-09', false, db, now);
  assert.equal(report.billing, null);
  assert.equal(calls.some((call) => call.model === 'billingEvent'), false);
  assert.equal(calls.every((call) => call.args.where.tenantId === 'tenant-1' || call.args.where.id === 'tenant-1'), true);
  assert.deepEqual(calls.find((call) => call.model === 'order' && call.method === 'groupBy').args.where.createdAt, {
    gte: new Date('2026-09-01T00:00:00Z'), lt: new Date('2026-10-01T00:00:00Z'),
  });
  assert.deepEqual(report.activity.sla, { total: 2, onTime: 1 });
  assert.equal(report.activity.createdOrders[0].count, 3);
});

test('includes tenant billing only with permission and renders a PDF with Polish text', async () => {
  const { db, calls } = database();
  const report = await getMonthlyReport('tenant-1', '2026-09', true, db, now);
  assert.deepEqual(report.billing, [
    { status: 'pending', currency: 'PLN', count: 2, netAmount: '125.50' },
    { status: 'unpriced', currency: 'PLN', count: 1, netAmount: null },
  ]);
  assert.deepEqual(calls.find((call) => call.model === 'billingEvent').args.where.billingPeriod, {
    gte: new Date('2026-09-01T00:00:00Z'), lt: new Date('2026-10-01T00:00:00Z'),
  });
  const pdf = await buildMonthlyReportPdf(report);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.length > 5000);
});

test('renders a report for an empty month without financial access', async () => {
  const { db } = database();
  db.box.count = async () => 0;
  db.folder.count = async () => 0;
  db.order.groupBy = async () => [];
  db.order.count = async () => 0;
  db.order.findMany = async () => [];
  db.hRFolder.count = async () => 0;
  const report = await getMonthlyReport('tenant-1', '2026-09', false, db, now);
  const pdf = await buildMonthlyReportPdf(report);
  assert.equal(report.activity.createdOrders.length, 0);
  assert.equal(report.billing, null);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
});
