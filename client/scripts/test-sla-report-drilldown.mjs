import assert from 'node:assert/strict';
import test from 'node:test';
import { readSlaReportDrilldown, slaReportOrderUrl } from '../src/utils/slaReportDrilldown.ts';

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
