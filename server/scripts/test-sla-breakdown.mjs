import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { prisma } = require('../dist/config/database.js');
const { ReportService, reportService } = require('../dist/modules/reports/report.service.js');
const { reportController } = require('../dist/modules/reports/report.controller.js');
const { buildSlaBreakdownExport } = require('../dist/modules/reports/sla-breakdown-export.js');
const XLSX = require('xlsx');

test('SLA breakdown groups by tenant and priority, with tenant filtering', async () => {
  const originalQueryRaw = prisma.$queryRaw;
  const originalFindMany = prisma.tenant.findMany;
  let query;
  prisma.$queryRaw = async (sql) => {
    query = sql;
    return [
      { tenantId: 'tenant-a', priority: 'normal', completed: 5, breached: 2, activeOverdue: 1 },
      { tenantId: 'tenant-a', priority: 'urgent', completed: 0, breached: 0, activeOverdue: 3 },
    ];
  };
  prisma.tenant.findMany = async () => [{ id: 'tenant-a', name: 'Firma A' }];

  try {
    const now = new Date('2026-10-15T12:00:00.000Z');
    const result = await new ReportService().getSlaBreakdown('tenant-a', 30, now);
    assert.match(query.sql, /"tenantId" = \?::uuid/);
    assert.ok(query.values.includes('tenant-a'));
    assert.ok(query.values.some((value) => value instanceof Date && value.getTime() === now.getTime()));
    assert.equal(result.since.toISOString(), '2026-09-15T12:00:00.000Z');
    assert.deepEqual(result.data.map(({ priority, onTime, slaRate }) => ({ priority, onTime, slaRate })), [
      { priority: 'urgent', onTime: 0, slaRate: null },
      { priority: 'normal', onTime: 3, slaRate: 60 },
    ]);
    assert.deepEqual(result.totals, { completed: 5, breached: 2, activeOverdue: 4 });

    await new ReportService().getSlaBreakdown(undefined, 30, now);
    assert.doesNotMatch(query.sql, /"tenantId" = \?::uuid/);
  } finally {
    prisma.$queryRaw = originalQueryRaw;
    prisma.tenant.findMany = originalFindMany;
  }
});

test('SLA breakdown blocks all-client access for tenant roles and rejects invalid periods', async () => {
  const original = reportService.getSlaBreakdown;
  let called = false;
  reportService.getSlaBreakdown = async () => { called = true; return {}; };
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

    const allowed = response();
    await reportController.getSlaBreakdown({ query: { scope: 'all' }, tenantId: null, user: { roles: ['SA'] } }, allowed, next);
    assert.equal(allowed.statusCode, 200);
    assert.equal(called, true);
  } finally {
    reportService.getSlaBreakdown = original;
  }
});

test('SLA export produces a readable Excel and UTF-8 CSV with the same totals', () => {
  const report = {
    days: 30,
    since: new Date('2026-09-15T12:00:00.000Z'),
    asOf: new Date('2026-10-15T12:00:00.000Z'),
    data: [
      { tenantId: 'a', tenantName: 'Spółdzielnia Żory', priority: 'urgent', completed: 5, breached: 2, activeOverdue: 1, onTime: 3, slaRate: 60 },
      { tenantId: 'b', tenantName: '=2+2', priority: 'normal', completed: 0, breached: 0, activeOverdue: 2, onTime: 0, slaRate: null },
    ],
    totals: { completed: 5, breached: 2, activeOverdue: 3 },
  };
  const excel = buildSlaBreakdownExport(report, 'all', 'xlsx');
  const workbook = XLSX.read(excel.buffer, { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets.SLA, { header: 1 });
  assert.match(excel.filename, /^raport_sla_2026-10-15T12-00-00-000Z\.xlsx$/);
  assert.equal(rows[3][1], 'Wszyscy klienci');
  assert.deepEqual(rows[5], ['Klient', 'Priorytet', 'Zakończone', 'Po terminie', 'Aktywne po terminie', 'W terminie (%)']);
  assert.deepEqual(rows[6], ['Spółdzielnia Żory', 'Maksymalny', 5, 2, 1, 60]);
  assert.equal(workbook.Sheets.SLA.A8.t, 's');
  assert.deepEqual(rows[8], ['Razem', '', 5, 2, 3, 60]);

  const csv = buildSlaBreakdownExport(report, 'tenant', 'csv');
  const content = csv.buffer.toString('utf8');
  assert.ok(content.startsWith('\uFEFF'));
  assert.match(content, /Spółdzielnia Żory;Maksymalny;5;2;1;60/);
  assert.match(content, /'=2\+2;Normalny;0;0;2/);
  assert.match(content, /Wybrany klient/);
  assert.match(csv.filename, /\.csv$/);
});

test('SLA export shares report scope checks and rejects unsupported formats', async () => {
  const original = reportService.getSlaBreakdown;
  const originalAudit = prisma.auditLog.create;
  let called = false;
  let audit;
  reportService.getSlaBreakdown = async () => {
    called = true;
    return { days: 30, since: new Date('2026-09-15T12:00:00.000Z'), asOf: new Date('2026-10-15T12:00:00.000Z'), data: [], totals: { completed: 0, breached: 0, activeOverdue: 0 } };
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

    const allowed = response();
    await reportController.exportSlaBreakdown({ query: { scope: 'all', days: '30', format: 'csv' }, tenantId: null, user: { roles: ['SA'], userId: 'admin-1' }, headers: {}, ip: '127.0.0.1' }, allowed, next);
    assert.equal(called, true);
    assert.equal(audit.action, 'report.sla.export');
    assert.equal(audit.userId, 'admin-1');
    assert.deepEqual(audit.newValues, { scope: 'all', days: 30, format: 'csv', rows: 0, asOf: '2026-10-15T12:00:00.000Z' });
    assert.equal(allowed.headers['Content-Type'], 'text/csv; charset=utf-8');
    assert.equal(allowed.headers['Content-Length'], allowed.body.length);
    assert.equal(allowed.headers['Cache-Control'], 'no-store');
  } finally {
    reportService.getSlaBreakdown = original;
    prisma.auditLog.create = originalAudit;
  }
});
