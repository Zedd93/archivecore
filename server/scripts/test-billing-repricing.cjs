const test = require('node:test');
const assert = require('node:assert/strict');
const { BillingEventStatus, Prisma } = require('@prisma/client');
const { BillingService } = require('../dist/modules/pricing/billing.service');

const tenantId = '8a4b7d9a-89e2-4f5f-9c75-cf3f37e1543e';

test('activating a rate prices each open event by its quantity', async () => {
  const calls = { grouped: [], updated: [] };
  const rate = {
    id: 'rate-1', serviceCode: 'scan_page', serviceName: 'Skan strony',
    unit: 'page', unitPrice: new Prisma.Decimal(3), vatRate: new Prisma.Decimal(23),
  };
  const closedMonth = new Date('2026-08-01T00:00:00.000Z');
  const db = {
    priceList: {
      findUnique: async () => ({
        id: 'price-list-1', tenantId, currency: 'PLN',
        validFrom: new Date('2026-08-01T00:00:00.000Z'), validTo: null, items: [rate],
      }),
    },
    billingPeriod: { findMany: async () => [{ periodStart: closedMonth }] },
    billingEvent: {
      groupBy: async (args) => {
        calls.grouped.push(args);
        assert.deepEqual(args.by, ['quantity']);
        assert.deepEqual(args.where.billingPeriod.notIn, [closedMonth]);
        assert.equal(args.where.tenantId, tenantId);
        assert.equal(args.where.serviceCode, 'scan_page');
        return args.where.status === BillingEventStatus.unpriced
          ? [{ quantity: new Prisma.Decimal(1) }, { quantity: new Prisma.Decimal(5) }]
          : [{ quantity: new Prisma.Decimal(2) }];
      },
      updateMany: async (args) => {
        calls.updated.push(args);
        return { count: 1 };
      },
    },
  };

  const count = await new BillingService().repriceUnpricedForPriceList('price-list-1', db);
  assert.equal(count, 3);
  assert.equal(calls.grouped.length, 2);
  assert.deepEqual(calls.updated.map(({ where, data }) => ({
    status: where.status,
    quantity: where.quantity.toString(),
    amount: data.netAmount.toString(),
    newStatus: data.status,
  })), [
    { status: BillingEventStatus.unpriced, quantity: '1', amount: '3', newStatus: BillingEventStatus.pending },
    { status: BillingEventStatus.unpriced, quantity: '5', amount: '15', newStatus: BillingEventStatus.pending },
    { status: BillingEventStatus.excluded, quantity: '2', amount: '6', newStatus: undefined },
  ]);
  assert.equal(calls.updated[2].where.netAmount, null);
  assert.equal(calls.updated[2].data.priceListItemId, rate.id);
});

test('an unknown price list leaves billing events unchanged', async () => {
  const db = {
    priceList: { findUnique: async () => null },
    billingEvent: { groupBy: async () => { throw new Error('unexpected billing query'); } },
  };
  assert.equal(await new BillingService().repriceUnpricedForPriceList('missing', db), 0);
});
