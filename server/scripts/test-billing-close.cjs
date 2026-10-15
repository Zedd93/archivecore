const test = require('node:test');
const assert = require('node:assert/strict');
const { mock } = require('node:test');
const { BillingPeriodStatus, Prisma } = require('@prisma/client');
const { prisma } = require('../dist/config/database');
const { BillingService } = require('../dist/modules/pricing/billing.service');

const tenantId = '8a4b7d9a-89e2-4f5f-9c75-cf3f37e1543e';
const userId = '4f71e99f-b69a-4ff3-95f9-507f75f6242f';
const month = '2026-09';

function setup({ claimCount = 1, unpriced = 0, pendingNet = '20', minimum = '30' } = {}) {
  const calls = { claimed: [], minimum: [], closedRead: 0, eventRead: 0 };
  const period = { id: 'period-1', status: BillingPeriodStatus.open, generatedAt: new Date('2026-10-01') };
  const tx = {
    billingPeriod: {
      findUnique: async () => period,
      updateMany: async (args) => {
        calls.claimed.push(args);
        return { count: claimCount };
      },
      findUniqueOrThrow: async () => {
        calls.closedRead++;
        return { ...period, status: BillingPeriodStatus.closed };
      },
    },
    billingEvent: {
      count: async () => { calls.eventRead++; return unpriced; },
      aggregate: async () => ({ _sum: { netAmount: new Prisma.Decimal(pendingNet) } }),
      create: async (args) => { calls.minimum.push(args); },
    },
    priceList: {
      findFirst: async () => ({
        id: 'price-list-1', currency: 'PLN', minimumMonthlyFee: new Prisma.Decimal(minimum), items: [],
      }),
    },
  };
  const transaction = mock.method(prisma, '$transaction', async (callback) => callback(tx));
  return { calls, restore: () => transaction.mock.restore() };
}

test('closing a month claims it once before calculating the minimum fee', async () => {
  const { calls, restore } = setup();
  try {
    const result = await new BillingService().closePeriod(tenantId, month, userId);
    assert.equal(calls.claimed.length, 1);
    assert.deepEqual(calls.claimed[0].where, { id: 'period-1', status: BillingPeriodStatus.open });
    assert.equal(calls.claimed[0].data.status, BillingPeriodStatus.closed);
    assert.equal(calls.claimed[0].data.closedById, userId);
    assert.equal(calls.minimum.length, 1);
    assert.equal(calls.minimum[0].data.netAmount.toString(), '10');
    assert.equal(result.pendingNetAmount.toString(), '30');
    assert.equal(calls.closedRead, 1);
  } finally { restore(); }
});

test('a competing close attempt fails before reading or writing billing events', async () => {
  const { calls, restore } = setup({ claimCount: 0 });
  try {
    await assert.rejects(new BillingService().closePeriod(tenantId, month, userId), /innego użytkownika/);
    assert.equal(calls.eventRead, 0);
    assert.equal(calls.minimum.length, 0);
    assert.equal(calls.closedRead, 0);
  } finally { restore(); }
});
