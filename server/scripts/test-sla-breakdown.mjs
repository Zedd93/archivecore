import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { prisma } = require('../dist/config/database.js');
const { ReportService, reportService } = require('../dist/modules/reports/report.service.js');
const { reportController } = require('../dist/modules/reports/report.controller.js');
const { buildSlaBreakdownExport } = require('../dist/modules/reports/sla-breakdown-export.js');
const { slaReportWhere } = require('../dist/modules/orders/sla-report-filter.js');
const { OrderService } = require('../dist/modules/orders/order.service.js');
const { ExportService } = require('../dist/modules/import-export/export.service.js');
const XLSX = require('xlsx');

test('SLA drilldown matches completed, breached and active-overdue report predicates', async () => {
  const originalQueryRaw = prisma.$queryRaw;
  let query;
  prisma.$queryRaw = async (sql) => { query = sql; return [{ id: 'late-order' }]; };
  const base = { slaDays: '30', slaAsOf: '2026-10-15T12:00:00.000Z' };

  try {
    const completed = await slaReportWhere('tenant-a', { ...base, slaReport: 'completed' });
    assert.equal(completed.status, 'completed');
    assert.equal(completed.completedAt.gte.toISOString(), '2026-09-15T12:00:00.000Z');
    assert.equal(completed.completedAt.lte.toISOString(), base.slaAsOf);
    assert.deepEqual(completed.slaDeadline, { not: null });

    const active = await slaReportWhere('tenant-a', { ...base, slaReport: 'activeOverdue' });
    assert.deepEqual(active.status.in, ['submitted', 'approved', 'in_progress', 'ready']);
    assert.equal(active.slaDeadline.lt.toISOString(), base.slaAsOf);

    const breached = await slaReportWhere('tenant-a', { ...base, slaReport: 'breached' });
    assert.deepEqual(breached.id.in, ['late-order']);
    assert.equal(breached.status, 'completed');
    assert.match(query.sql, /"completedAt" > "slaDeadline"/);
    assert.match(query.sql, /"completedAt" <= \?/);
    assert.match(query.sql, /"tenantId" = \?::uuid/);
    assert.ok(query.values.includes('tenant-a'));

    await assert.rejects(() => slaReportWhere('tenant-a', { ...base, slaDays: '999', slaReport: 'completed' }), { statusCode: 400 });
    await assert.rejects(() => slaReportWhere('tenant-a', { ...base, slaAsOf: 'bad-date', slaReport: 'breached' }), { statusCode: 400 });
    await assert.rejects(() => slaReportWhere('tenant-a', { ...base, slaReport: 'other' }), { statusCode: 400 });
  } finally {
    prisma.$queryRaw = originalQueryRaw;
  }
});

test('order list and export apply the same SLA drilldown without dropping tenant scope', async () => {
  const originalQueryRaw = prisma.$queryRaw;
  const originalFindMany = prisma.order.findMany;
  const originalCount = prisma.order.count;
  const captured = [];
  prisma.$queryRaw = async () => [{ id: 'late-order' }];
  prisma.order.findMany = async ({ where }) => { captured.push(where); return []; };
  prisma.order.count = async ({ where }) => { captured.push(where); return 0; };
  const filters = {
    slaReport: 'breached', slaDays: '30', slaAsOf: '2026-10-15T12:00:00.000Z',
    orderType: 'checkout', priority: 'urgent',
  };

  try {
    await new OrderService().list('tenant-a', filters, 0, 20);
    await new ExportService().exportOrders('tenant-a', filters, 'csv');
    assert.equal(captured.length, 3);
    for (const where of captured) {
      assert.equal(where.tenantId, 'tenant-a');
      assert.equal(where.orderType, 'checkout');
      assert.equal(where.priority, 'urgent');
      assert.deepEqual(where.AND[0].id.in, ['late-order']);
    }
  } finally {
    prisma.$queryRaw = originalQueryRaw;
    prisma.order.findMany = originalFindMany;
    prisma.order.count = originalCount;
  }
});

test('SLA breakdown groups by tenant, order type and priority, with scoped filters', async () => {
  const originalQueryRaw = prisma.$queryRaw;
  const originalFindMany = prisma.tenant.findMany;
  let query;
  prisma.$queryRaw = async (sql) => {
    query = sql;
    return [
      { tenantId: 'tenant-a', orderType: 'checkout', priority: 'normal', completed: 5, breached: 2, activeOverdue: 1 },
      { tenantId: 'tenant-a', orderType: 'scan', priority: 'urgent', completed: 0, breached: 0, activeOverdue: 3 },
    ];
  };
  prisma.tenant.findMany = async () => [{ id: 'tenant-a', name: 'Firma A' }];

  try {
    const now = new Date('2026-10-15T12:00:00.000Z');
    const result = await new ReportService().getSlaBreakdown('tenant-a', 30, now);
    assert.match(query.sql, /"tenantId" = \?::uuid/);
    assert.match(query.sql, /GROUP BY "tenantId", "orderType", "priority"/);
    assert.match(query.sql, /"completedAt" <= \?/);
    assert.ok(query.values.includes('tenant-a'));
    assert.ok(query.values.some((value) => value instanceof Date && value.getTime() === now.getTime()));
    assert.equal(result.since.toISOString(), '2026-09-15T12:00:00.000Z');
    assert.deepEqual(result.data.map(({ orderType, priority, onTime, slaRate }) => ({ orderType, priority, onTime, slaRate })), [
      { orderType: 'checkout', priority: 'normal', onTime: 3, slaRate: 60 },
      { orderType: 'scan', priority: 'urgent', onTime: 0, slaRate: null },
    ]);
    assert.deepEqual(result.totals, { completed: 5, breached: 2, activeOverdue: 4 });

    await new ReportService().getSlaBreakdown(undefined, 30, now);
    assert.doesNotMatch(query.sql, /"tenantId" = \?::uuid/);
    assert.doesNotMatch(query.sql, /AND "orderType" = \?::"OrderType"/);

    const filtered = await new ReportService().getSlaBreakdown('tenant-a', 30, now, 'scan');
    assert.match(query.sql, /AND "orderType" = \?::"OrderType"/);
    assert.ok(query.values.includes('scan'));
    assert.equal(filtered.orderType, 'scan');
  } finally {
    prisma.$queryRaw = originalQueryRaw;
    prisma.tenant.findMany = originalFindMany;
  }
});

test('monthly SLA trend keeps empty months and uses the same tenant and order-type scope', async () => {
  const originalQueryRaw = prisma.$queryRaw;
  let query;
  prisma.$queryRaw = async (sql) => {
    query = sql;
    return [
      { month: '2026-08', completed: 2, breached: 0 },
      { month: '2026-09', completed: 0, breached: 0 },
      { month: '2026-10', completed: 5, breached: 2 },
    ];
  };
  try {
    const now = new Date('2026-10-15T12:00:00.000Z');
    const trend = await new ReportService().getSlaTrend('tenant-a', 90, now, 'checkout');
    assert.equal(trend.since.toISOString(), '2026-07-17T12:00:00.000Z');
    assert.deepEqual(trend.months.map(({ month, onTime, slaRate }) => ({ month, onTime, slaRate })), [
      { month: '2026-08', onTime: 2, slaRate: 100 },
      { month: '2026-09', onTime: 0, slaRate: null },
      { month: '2026-10', onTime: 3, slaRate: 60 },
    ]);
    assert.match(query.sql, /generate_series/);
    assert.match(query.sql, /AT TIME ZONE 'Europe\/Warsaw'/);
    assert.match(query.sql, /"tenantId" = \?::uuid/);
    assert.match(query.sql, /"orderType" = \?::"OrderType"/);
    assert.match(query.sql, /"completedAt" > "slaDeadline"/);
    assert.ok(query.values.includes('tenant-a'));
    assert.ok(query.values.includes('checkout'));

    await new ReportService().getSlaTrend(undefined, 30, now);
    assert.doesNotMatch(query.sql, /"tenantId" = \?::uuid/);
    assert.doesNotMatch(query.sql, /"orderType" = \?::"OrderType"/);
  } finally {
    prisma.$queryRaw = originalQueryRaw;
  }
});

test('SLA breakdown blocks all-client access for tenant roles and rejects invalid periods', async () => {
  const original = reportService.getSlaBreakdown;
  let called = false;
  let requestedType;
  reportService.getSlaBreakdown = async (_tenantId, _days, _now, orderType) => { called = true; requestedType = orderType; return {}; };
  const response = () => ({
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  });
  const next = (error) => { throw error; };

  try {
    const denied = response();
    await reportController.getSlaBreakdown({ query: { scope: 'all' }, tenantId: 'tenant-a', user: { roles: ['TK'] } }, denied, next);
    assert.equal(denied.statusCode, 403);
    assert.equal(called, false);

    const invalid = response();
    await reportController.getSlaBreakdown({ query: { days: '999' }, tenantId: 'tenant-a', user: { roles: ['TK'] } }, invalid, next);
    assert.equal(invalid.statusCode, 400);
    assert.equal(called, false);

    const invalidType = response();
    await reportController.getSlaBreakdown({ query: { orderType: 'unknown' }, tenantId: 'tenant-a', user: { roles: ['TK'] } }, invalidType, next);
    assert.equal(invalidType.statusCode, 400);
    assert.equal(called, false);

    const allowed = response();
    await reportController.getSlaBreakdown({ query: { scope: 'all', orderType: 'checkout' }, tenantId: null, user: { roles: ['SA'] } }, allowed, next);
    assert.equal(allowed.statusCode, 200);
    assert.equal(called, true);
    assert.equal(requestedType, 'checkout');
  } finally {
    reportService.getSlaBreakdown = original;
  }
});

test('monthly SLA trend reuses report scope and period authorization', async () => {
  const original = reportService.getSlaTrend;
  let requested;
  reportService.getSlaTrend = async (tenantId, days, _now, orderType) => {
    requested = { tenantId, days, orderType };
    return { months: [] };
  };
  const response = () => ({
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  });
  const next = (error) => { throw error; };
  try {
    const denied = response();
    await reportController.getSlaTrend({ query: { scope: 'all' }, tenantId: 'tenant-a', user: { roles: ['TK'] } }, denied, next);
    assert.equal(denied.statusCode, 403);
    assert.equal(requested, undefined);

    const invalid = response();
    await reportController.getSlaTrend({ query: { days: '10' }, tenantId: 'tenant-a', user: { roles: ['TK'] } }, invalid, next);
    assert.equal(invalid.statusCode, 400);
    assert.equal(requested, undefined);

    const allowed = response();
    await reportController.getSlaTrend({ query: { scope: 'all', days: '90', orderType: 'checkout' }, tenantId: null, user: { roles: ['SA'] } }, allowed, next);
    assert.equal(allowed.statusCode, 200);
    assert.deepEqual(requested, { tenantId: undefined, days: 90, orderType: 'checkout' });
  } finally {
    reportService.getSlaTrend = original;
  }
});

test('SLA export produces a readable Excel and UTF-8 CSV with the same totals', () => {
  const report = {
    days: 30,
    since: new Date('2026-09-15T12:00:00.000Z'),
    asOf: new Date('2026-10-15T12:00:00.000Z'),
    orderType: null,
    data: [
      { tenantId: 'a', tenantName: 'Spółdzielnia Żory', orderType: 'checkout', priority: 'urgent', completed: 5, breached: 2, activeOverdue: 1, onTime: 3, slaRate: 60 },
      { tenantId: 'b', tenantName: '=2+2', orderType: 'scan', priority: 'normal', completed: 0, breached: 0, activeOverdue: 2, onTime: 0, slaRate: null },
    ],
    totals: { completed: 5, breached: 2, activeOverdue: 3 },
  };
  const excel = buildSlaBreakdownExport(report, 'all', 'xlsx');
  const workbook = XLSX.read(excel.buffer, { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets.SLA, { header: 1 });
  assert.match(excel.filename, /^raport_sla_2026-10-15T12-00-00-000Z\.xlsx$/);
  assert.equal(rows[3][1], 'Wszyscy klienci');
  assert.equal(rows[4][1], 'Wszystkie');
  assert.deepEqual(rows[6], ['Klient', 'Rodzaj zlecenia', 'Priorytet', 'Zakończone', 'Po terminie', 'Aktywne po terminie', 'W terminie (%)']);
  assert.deepEqual(rows[7], ['Spółdzielnia Żory', 'Wydanie', 'Maksymalny', 5, 2, 1, 60]);
  assert.equal(workbook.Sheets.SLA.A8.t, 's');
  assert.deepEqual(rows[9], ['Razem', '', '', 5, 2, 3, 60]);

  const csv = buildSlaBreakdownExport(report, 'tenant', 'csv');
  const content = csv.buffer.toString('utf8');
  assert.ok(content.startsWith('\uFEFF'));
  assert.match(content, /Spółdzielnia Żory;Wydanie;Maksymalny;5;2;1;60/);
  assert.match(content, /'=2\+2;Skan na żądanie;Normalny;0;0;2/);
  assert.match(content, /Wybrany klient/);
  assert.match(csv.filename, /\.csv$/);
});

test('SLA export shares report scope checks and rejects unsupported formats', async () => {
  const original = reportService.getSlaBreakdown;
  const originalAudit = prisma.auditLog.create;
  let called = false;
  let requestedType;
  let audit;
  reportService.getSlaBreakdown = async (_tenantId, _days, _now, orderType) => {
    called = true;
    requestedType = orderType;
    return { days: 30, since: new Date('2026-09-15T12:00:00.000Z'), asOf: new Date('2026-10-15T12:00:00.000Z'), orderType: orderType ?? null, data: [], totals: { completed: 0, breached: 0, activeOverdue: 0 } };
  };
  prisma.auditLog.create = async (query) => { audit = query.data; return { id: 'audit-1' }; };
  const response = () => ({
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader(name, value) { this.headers[name] = value; return this; },
    send(body) { this.body = body; return this; },
  });
  const next = (error) => { throw error; };
  try {
    const denied = response();
    await reportController.exportSlaBreakdown({ query: { scope: 'all', format: 'csv' }, tenantId: 'tenant-a', user: { roles: ['TK'] } }, denied, next);
    assert.equal(denied.statusCode, 403);
    assert.equal(called, false);
    assert.equal(audit, undefined);

    const invalid = response();
    await reportController.exportSlaBreakdown({ query: { format: 'pdf' }, tenantId: 'tenant-a', user: { roles: ['TK'] } }, invalid, next);
    assert.equal(invalid.statusCode, 400);
    assert.equal(called, false);
    assert.equal(audit, undefined);

    const invalidType = response();
    await reportController.exportSlaBreakdown({ query: { orderType: 'other' }, tenantId: 'tenant-a', user: { roles: ['TK'] } }, invalidType, next);
    assert.equal(invalidType.statusCode, 400);
    assert.equal(called, false);

    const allowed = response();
    await reportController.exportSlaBreakdown({ query: { scope: 'all', days: '30', orderType: 'scan', format: 'csv' }, tenantId: null, user: { roles: ['SA'], userId: 'admin-1' }, headers: {}, ip: '127.0.0.1' }, allowed, next);
    assert.equal(called, true);
    assert.equal(requestedType, 'scan');
    assert.equal(audit.action, 'report.sla.export');
    assert.equal(audit.userId, 'admin-1');
    assert.deepEqual(audit.newValues, { scope: 'all', days: 30, orderType: 'scan', format: 'csv', rows: 0, asOf: '2026-10-15T12:00:00.000Z' });
    assert.match(allowed.body.toString('utf8'), /Rodzaj zlecenia;Skan na żądanie/);
    assert.equal(allowed.headers['Content-Type'], 'text/csv; charset=utf-8');
    assert.equal(allowed.headers['Content-Length'], allowed.body.length);
    assert.equal(allowed.headers['Cache-Control'], 'no-store');
  } finally {
    reportService.getSlaBreakdown = original;
    prisma.auditLog.create = originalAudit;
  }
});
