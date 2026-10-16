import assert from 'node:assert/strict';
import test from 'node:test';
import { readSlaReportDrilldown, slaReportOrderUrl } from '../src/utils/slaReportDrilldown.ts';
import { slaTargetStatus } from '../src/utils/slaTarget.ts';
import { readSlaReportView } from '../src/utils/slaReportView.ts';

test('SLA report link preserves tenant, report snapshot, type and priority', () => {
  const filter = {
    slaReport: 'breached',
    slaDays: '90',
    slaAsOf: '2026-10-15T12:00:00.000Z',
    tenantId: '45d0c106-8298-43b7-adc8-6846241655db',
    orderType: 'checkout',
    priority: 'urgent',
  };
  const url = slaReportOrderUrl(filter);
  assert.equal(readSlaReportDrilldown(new URL(url, 'https://archivecore.example').search)?.slaReport, 'breached');
  assert.deepEqual(readSlaReportDrilldown(url.split('?')[1]), filter);
  assert.equal(readSlaReportDrilldown('?slaReport=breached'), null);
  assert.equal(readSlaReportDrilldown(url.replace('checkout', 'invalid')), null);
  assert.equal(readSlaReportDrilldown(url.replace(filter.tenantId, 'not-a-tenant')), null);
});

test('SLA target compares the displayed rounded rate and ignores empty samples', () => {
  assert.equal(slaTargetStatus(0, 0, 95), 'noData');
  assert.equal(slaTargetStatus(20, 1, 95), 'met');
  assert.equal(slaTargetStatus(20, 2, 95), 'below');
  assert.equal(slaTargetStatus(100, 5, 95), 'met');
  assert.equal(slaTargetStatus(200, 11, 95), 'met');
  assert.equal(slaTargetStatus(200, 12, 95), 'below');
  assert.equal(slaTargetStatus(200, 10, 95), 'met');
});

test('SLA alert report link keeps the period and never grants global scope to a client role', () => {
  assert.deepEqual(readSlaReportView('?slaDays=30&slaScope=all', true), { days: 30, scope: 'all' });
  assert.deepEqual(readSlaReportView('?slaDays=30&slaScope=all', false), { days: 30, scope: 'tenant' });
  assert.deepEqual(readSlaReportView('?slaDays=999&slaScope=all', true), { days: 180, scope: 'all' });
  assert.deepEqual(readSlaReportView('', true), { days: 180, scope: 'tenant' });
});
