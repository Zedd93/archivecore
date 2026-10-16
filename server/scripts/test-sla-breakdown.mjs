import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { prisma } = require('../dist/config/database.js');
const { ReportService, reportService } = require('../dist/modules/reports/report.service.js');
const { reportController } = require('../dist/modules/reports/report.controller.js');
const reportRoutes = require('../dist/modules/reports/report.routes.js').default;
const { buildSlaBreakdownExport, buildSlaTenantTrendExport } = require('../dist/modules/reports/sla-breakdown-export.js');
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
  prisma.tenant.findMany = async () => [{ id: 'tenant-a', name: 'Firma A', slaTargetPercent: 97 }];

  try {
    const now = new Date('2026-10-15T12:00:00.000Z');
    const result = await new ReportService().getSlaBreakdown('tenant-a', 30, now);
    assert.match(query.sql, /"tenantId" = \?::uuid/);
    assert.match(query.sql, /GROUP BY "tenantId", "orderType", "priority"/);
    assert.match(query.sql, /"completedAt" <= \?/);
    assert.ok(query.values.includes('tenant-a'));
    assert.ok(query.values.some((value) => value instanceof Date && value.getTime() === now.getTime()));
    assert.equal(result.since.toISOString(), '2026-09-15T12:00:00.000Z');
    assert.equal(result.slaTargetPercent, 97);
    assert.deepEqual(result.data.map(({ orderType, priority, onTime, slaRate }) => ({ orderType, priority, onTime, slaRate })), [
      { orderType: 'checkout', priority: 'normal', onTime: 3, slaRate: 60 },
      { orderType: 'scan', priority: 'urgent', onTime: 0, slaRate: null },
    ]);
    assert.deepEqual(result.totals, { completed: 5, breached: 2, activeOverdue: 4 });

    const allTenantsReport = await new ReportService().getSlaBreakdown(undefined, 30, now);
    assert.equal(allTenantsReport.slaTargetPercent, null);
    assert.doesNotMatch(query.sql, /"tenantId" = \?::uuid/);
    assert.doesNotMatch(query.sql, /AND "orderType" = \?::"OrderType"/);

    prisma.$queryRaw = async () => [];
    const emptyTenantReport = await new ReportService().getSlaBreakdown('tenant-a', 30, now);
    assert.equal(emptyTenantReport.slaTargetPercent, 97);
    prisma.$queryRaw = async (sql) => {
      query = sql;
      return [{ tenantId: 'tenant-a', orderType: 'checkout', priority: 'normal', completed: 5, breached: 2, activeOverdue: 1 }];
    };

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

test('tenant SLA trend compares monthly rates without losing empty months or year boundaries', async () => {
  const originalQueryRaw = prisma.$queryRaw;
  const originalFindMany = prisma.tenant.findMany;
  let query;
  prisma.$queryRaw = async (sql) => {
    query = sql;
    return [
      { tenantId: 'tenant-b', month: '2025-12', completed: 2, breached: 1 },
      { tenantId: 'tenant-a', month: '2026-01', completed: 4, breached: 1 },
      { tenantId: 'tenant-b', month: '2026-01', completed: 1, breached: 0 },
    ];
  };
  prisma.tenant.findMany = async () => [
    { id: 'tenant-a', name: 'Alfa', slaTargetPercent: 97 },
    { id: 'tenant-b', name: 'Beta', slaTargetPercent: 90 },
  ];
  try {
    const now = new Date('2026-01-01T00:30:00.000Z');
    const trend = await new ReportService().getSlaTenantTrends(30, now, 'checkout');
    assert.deepEqual(trend.months, ['2025-12', '2026-01']);
    assert.deepEqual(trend.data.map(({ tenantName, completed, breached, slaRate }) => ({ tenantName, completed, breached, slaRate })), [
      { tenantName: 'Alfa', completed: 4, breached: 1, slaRate: 75 },
      { tenantName: 'Beta', completed: 3, breached: 1, slaRate: 67 },
    ]);
    assert.deepEqual(trend.data.map(({ slaTargetPercent }) => slaTargetPercent), [97, 90]);
    assert.deepEqual(trend.data[0].months, [
      { month: '2025-12', completed: 0, breached: 0, slaRate: null },
      { month: '2026-01', completed: 4, breached: 1, slaRate: 75 },
    ]);
    assert.match(query.sql, /AT TIME ZONE 'Europe\/Warsaw'/);
    assert.match(query.sql, /"completedAt" > "slaDeadline"/);
    assert.match(query.sql, /"orderType" = \?::"OrderType"/);
    assert.doesNotMatch(query.sql, /"tenantId" = \?::uuid/);
    assert.ok(query.values.includes('checkout'));

    prisma.$queryRaw = async () => [];
    const empty = await new ReportService().getSlaTenantTrends(30, now);
    assert.deepEqual(empty.data, []);
    assert.deepEqual(empty.months, ['2025-12', '2026-01']);
  } finally {
    prisma.$queryRaw = originalQueryRaw;
    prisma.tenant.findMany = originalFindMany;
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

test('cross-tenant SLA comparison is denied to client roles', async () => {
  const original = reportService.getSlaTenantTrends;
  let requested;
  reportService.getSlaTenantTrends = async (days, _now, orderType) => {
    requested = { days, orderType };
    return { months: [], data: [] };
  };
  const response = () => ({
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  });
  const next = (error) => { throw error; };
  try {
    const denied = response();
    await reportController.getSlaTenantTrends({ query: { scope: 'all' }, tenantId: 'tenant-a', user: { roles: ['TK'] } }, denied, next);
    assert.equal(denied.statusCode, 403);
    assert.equal(requested, undefined);

    const wrongScope = response();
    await reportController.getSlaTenantTrends({ query: { scope: 'tenant' }, tenantId: 'tenant-a', user: { roles: ['SA'] } }, wrongScope, next);
    assert.equal(wrongScope.statusCode, 400);
    assert.equal(requested, undefined);

    const allowed = response();
    await reportController.getSlaTenantTrends({ query: { scope: 'all', days: '90', orderType: 'scan' }, tenantId: null, user: { roles: ['DA'] } }, allowed, next);
    assert.equal(allowed.statusCode, 200);
    assert.deepEqual(requested, { days: 90, orderType: 'scan' });
  } finally {
    reportService.getSlaTenantTrends = original;
  }
});

test('SLA export produces a readable Excel and UTF-8 CSV with the same totals', () => {
  const report = {
    days: 30,
    since: new Date('2026-09-15T12:00:00.000Z'),
    asOf: new Date('2026-10-15T12:00:00.000Z'),
    orderType: null,
    slaTargetPercent: null,
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
  assert.deepEqual(XLSX.utils.sheet_to_json(XLSX.read(buildSlaBreakdownExport({ ...report, slaTargetPercent: 97 }, 'tenant', 'xlsx').buffer, { type: 'buffer' }).Sheets.SLA, { header: 1 })[10], ['Cel SLA klienta (%)', 97]);

  const csv = buildSlaBreakdownExport(report, 'tenant', 'csv');
  const content = csv.buffer.toString('utf8');
  assert.ok(content.startsWith('\uFEFF'));
  assert.match(content, /Spółdzielnia Żory;Wydanie;Maksymalny;5;2;1;60/);
  assert.match(content, /'=2\+2;Skan na żądanie;Normalny;0;0;2/);
  assert.match(content, /Wybrany klient/);
  assert.match(csv.filename, /\.csv$/);
});

test('tenant trend export preserves monthly samples, totals and CSV formula safety', () => {
  const report = {
    days: 30,
    since: new Date('2026-09-15T12:00:00.000Z'),
    asOf: new Date('2026-10-15T12:00:00.000Z'),
    orderType: 'checkout',
    months: ['2026-09', '2026-10'],
    data: [
      { tenantId: 'a', tenantName: 'Spółdzielnia Żory', completed: 3, breached: 1, slaRate: 67, slaTargetPercent: 97, months: [
        { month: '2026-09', completed: 2, breached: 0, slaRate: 100 },
        { month: '2026-10', completed: 1, breached: 1, slaRate: 0 },
      ] },
      { tenantId: 'b', tenantName: '=2+2', completed: 1, breached: 0, slaRate: 100, slaTargetPercent: 90, months: [
        { month: '2026-09', completed: 0, breached: 0, slaRate: null },
        { month: '2026-10', completed: 1, breached: 0, slaRate: 100 },
      ] },
    ],
  };
  const excel = buildSlaTenantTrendExport(report, 'xlsx');
  const workbook = XLSX.read(excel.buffer, { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets['Klienci SLA'], { header: 1, defval: '' });
  assert.match(excel.filename, /^raport_sla_klienci_2026-10-15T12-00-00-000Z\.xlsx$/);
  assert.equal(rows[2][1], 'Wydanie');
  assert.deepEqual(rows[5], ['Klient', '2026-09 SLA (%)', '2026-09 zleceń', '2026-10 SLA (%)', '2026-10 zleceń', 'Razem zleceń', 'Po terminie', 'W terminie (%)', 'Cel SLA (%)']);
  assert.deepEqual(rows[6], ['Spółdzielnia Żory', 100, 2, 0, 1, 3, 1, 67, 97]);
  assert.deepEqual(rows[7], ['=2+2', '', 0, 100, 1, 1, 0, 100, 90]);
  assert.equal(workbook.Sheets['Klienci SLA'].A8.t, 's');
  assert.deepEqual(rows[8], ['Razem', 100, 2, 50, 2, 4, 1, 75, '']);

  const csv = buildSlaTenantTrendExport(report, 'csv');
  const content = csv.buffer.toString('utf8');
  assert.ok(content.startsWith('\uFEFF'));
  assert.match(content, /Spółdzielnia Żory;100;2;0;1;3;1;67;97/);
  assert.match(content, /'=2\+2;;0;100;1;1;0;100;90/);
  assert.match(content, /Razem;100;2;50;2;4;1;75/);
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

test('tenant trend export requires global scope, validates format and records a successful download', async () => {
  const original = reportService.getSlaTenantTrends;
  const originalAudit = prisma.auditLog.create;
  let called = false;
  let requestedType;
  let audit;
  reportService.getSlaTenantTrends = async (_days, _now, orderType) => {
    called = true;
    requestedType = orderType;
    return {
      days: 30,
      since: new Date('2026-09-15T12:00:00.000Z'),
      asOf: new Date('2026-10-15T12:00:00.000Z'),
      orderType: orderType ?? null,
      months: ['2026-09', '2026-10'],
      data: [],
    };
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
    await reportController.exportSlaTenantTrends({ query: { scope: 'all', format: 'csv' }, tenantId: 'tenant-a', user: { roles: ['TK'] } }, denied, next);
    assert.equal(denied.statusCode, 403);
    assert.equal(called, false);
    assert.equal(audit, undefined);

    const wrongScope = response();
    await reportController.exportSlaTenantTrends({ query: { scope: 'tenant' }, tenantId: 'tenant-a', user: { roles: ['SA'] } }, wrongScope, next);
    assert.equal(wrongScope.statusCode, 400);
    assert.equal(called, false);

    const invalid = response();
    await reportController.exportSlaTenantTrends({ query: { scope: 'all', format: 'pdf' }, tenantId: null, user: { roles: ['SA'] } }, invalid, next);
    assert.equal(invalid.statusCode, 400);
    assert.equal(called, false);

    const allowed = response();
    await reportController.exportSlaTenantTrends({ query: { scope: 'all', days: '30', orderType: 'checkout', format: 'csv' }, tenantId: null, user: { roles: ['DA'], userId: 'admin-1' }, headers: {}, ip: '127.0.0.1' }, allowed, next);
    assert.equal(called, true);
    assert.equal(requestedType, 'checkout');
    assert.equal(audit.action, 'report.sla.tenant_trend.export');
    assert.equal(audit.userId, 'admin-1');
    assert.deepEqual(audit.newValues, { scope: 'all', days: 30, orderType: 'checkout', format: 'csv', tenants: 0, asOf: '2026-10-15T12:00:00.000Z' });
    assert.match(allowed.body.toString('utf8'), /Rodzaj zlecenia;Wydanie/);
    assert.equal(allowed.headers['Content-Type'], 'text/csv; charset=utf-8');
    assert.equal(allowed.headers['Content-Length'], allowed.body.length);
    assert.equal(allowed.headers['Cache-Control'], 'no-store');
  } finally {
    reportService.getSlaTenantTrends = original;
    prisma.auditLog.create = originalAudit;
  }
});

test('tenant trend export route requires report view, export permission and an admin role', () => {
  const route = reportRoutes.stack.find((layer) => layer.route?.path === '/sla/trend/tenants/export')?.route;
  assert.ok(route);
  const guards = route.stack.slice(2, -1).map((layer) => layer.handle);
  const check = (roles, permissions) => {
    const req = { user: { roles, permissions } };
    const res = { status(code) { this.statusCode = code; return this; }, json() { return this; } };
    for (const guard of guards) {
      let allowed = false;
      guard(req, res, () => { allowed = true; });
      if (!allowed) return res.statusCode;
    }
    return 200;
  };
  assert.equal(check(['SA'], ['report.view']), 403);
  assert.equal(check(['TK'], ['report.view', 'report.export']), 403);
  assert.equal(check(['SA'], ['report.view', 'report.export']), 200);
});
