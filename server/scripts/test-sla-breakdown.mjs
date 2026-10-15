import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { prisma } = require('../dist/config/database.js');
const { ReportService, reportService } = require('../dist/modules/reports/report.service.js');
const { reportController } = require('../dist/modules/reports/report.controller.js');

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
