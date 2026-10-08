const test = require('node:test');
const assert = require('node:assert/strict');
const { mock } = require('node:test');
const { BillingPeriodStatus, BillingEventStatus } = require('@prisma/client');
const { prisma } = require('../dist/config/database');
const { billingInvoiceService } = require('../dist/modules/pricing/billing-invoice.service');

const tenantId = '8a4b7d9a-89e2-4f5f-9c75-cf3f37e1543e';
const userId = '4f71e99f-b69a-4ff3-95f9-507f75f6242f';

function setup({ status = BillingPeriodStatus.closed, invoiceNumber = null, invoicedAt = null,
  pending = 2, unpriced = 0, invoiced = 0, updatedCount = pending } = {}) {
  const calls = { periodUpdates: [], eventUpdates: [], audits: [] };
  const tx = {
    billingPeriod: {
      findUnique: async () => ({ id: 'period-id', status, invoiceNumber, invoicedAt }),
      updateMany: async (args) => {
        calls.periodUpdates.push(args);
        return { count: 1 };
      },
    },
    billingEvent: {
      count: async ({ where }) => ({
        [BillingEventStatus.pending]: pending,
        [BillingEventStatus.unpriced]: unpriced,
        [BillingEventStatus.invoiced]: invoiced,
      })[where.status],
      updateMany: async (args) => {
        calls.eventUpdates.push(args);
        return { count: updatedCount };
      },
    },
    auditLog: {
      create: async (args) => { calls.audits.push(args); },
    },
  };
  const transaction = mock.method(prisma, '$transaction', async (callback) => callback(tx));
  return { calls, restore: () => transaction.mock.restore() };
}

test('confirms one closed month, marks all pending events, and audits the reference', async () => {
  const { calls, restore } = setup();
  try {
    const result = await billingInvoiceService.confirmInvoice(tenantId, '2026-09', ' FV/10/2026 ', userId);
    assert.equal(result.invoiceNumber, 'FV/10/2026');
    assert.equal(result.updatedEvents, 2);
    assert.equal(calls.periodUpdates[0].where.invoiceNumber, null);
    assert.equal(calls.eventUpdates[0].where.status, BillingEventStatus.pending);
    assert.equal(calls.eventUpdates[0].data.status, BillingEventStatus.invoiced);
    assert.equal(calls.audits[0].data.newValues.invoiceNumber, 'FV/10/2026');
  } finally { restore(); }
});

test('rejects an open month and leaves its events untouched', async () => {
  const { calls, restore } = setup({ status: BillingPeriodStatus.open });
  try {
    await assert.rejects(billingInvoiceService.confirmInvoice(tenantId, '2026-09', 'FV/10/2026', userId), /zamknij miesiąc/);
    assert.equal(calls.eventUpdates.length, 0);
  } finally { restore(); }
});

test('rejects unpriced events', async () => {
  const { calls, restore } = setup({ unpriced: 1 });
  try {
    await assert.rejects(billingInvoiceService.confirmInvoice(tenantId, '2026-09', 'FV/10/2026', userId), /nie ma ceny/);
    assert.equal(calls.periodUpdates.length, 0);
  } finally { restore(); }
});

test('rejects a month with no pending items', async () => {
  const { calls, restore } = setup({ pending: 0 });
  try {
    await assert.rejects(billingInvoiceService.confirmInvoice(tenantId, '2026-09', 'FV/10/2026', userId), /Brak pozycji/);
    assert.equal(calls.periodUpdates.length, 0);
  } finally { restore(); }
});

test('rejects a month whose items were already invoiced separately', async () => {
  const { calls, restore } = setup({ invoiced: 1 });
  try {
    await assert.rejects(billingInvoiceService.confirmInvoice(tenantId, '2026-09', 'FV/10/2026', userId), /już oznaczona/);
    assert.equal(calls.periodUpdates.length, 0);
  } finally { restore(); }
});

test('same invoice reference is idempotent, but a different reference is rejected', async () => {
  const { calls, restore } = setup({ invoiceNumber: 'FV/10/2026', invoicedAt: new Date('2026-10-01') });
  try {
    const result = await billingInvoiceService.confirmInvoice(tenantId, '2026-09', 'FV/10/2026', userId);
    assert.equal(result.updatedEvents, 0);
    await assert.rejects(billingInvoiceService.confirmInvoice(tenantId, '2026-09', 'FV/11/2026', userId), /innej faktury/);
    assert.equal(calls.eventUpdates.length, 0);
    assert.equal(calls.audits.length, 0);
  } finally { restore(); }
});

test('rejects a changed event set so the database transaction can roll back', async () => {
  const { calls, restore } = setup({ pending: 2, updatedCount: 1 });
  try {
    await assert.rejects(billingInvoiceService.confirmInvoice(tenantId, '2026-09', 'FV/10/2026', userId), /zmieniły się/);
    assert.equal(calls.audits.length, 0);
  } finally { restore(); }
});
