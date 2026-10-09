import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { prisma } = require('../dist/config/database.js');
const { BoxService, buildBoxWhereSql } = require('../dist/modules/boxes/box.service.js');
const { billingService } = require('../dist/modules/pricing/billing.service.js');
const { Prisma } = require('@prisma/client');
const { bulkBoxReceiveSchema } = require('../../shared/src/validators/box.schema.ts');

const tenantId = '1f11541e-00c7-4bbd-8059-bbb7d189a013';
const boxId = 'a07ca020-f00e-485c-9d01-f9ed697e2f40';
const locationId = '08675a3a-8a69-477a-82f1-b52d74b97bde';
const userId = '39b9500e-71b6-4fc4-bf3a-9a0a5f4b698b';

function setup({ boxes = [{ id: boxId, boxNumber: 'K-2026-000001', status: 'active', locationId: null }], previousReceipts = [], updateCount = 1, billingError = false } = {}) {
  const service = new BoxService();
  const calls = { moved: [], locations: [], custody: [], billing: [] };
  const tx = {
    box: {
      findMany: async (args) => {
        assert.equal(args.where.tenantId, tenantId);
        assert.equal(args.where.deletedAt, null);
        return boxes;
      },
      updateMany: async (args) => {
        calls.moved.push(args);
        assert.equal(args.where.locationId, null);
        assert.equal(args.where.tenantId, tenantId);
        return { count: updateCount };
      },
    },
    custodyEvent: {
      findMany: async (args) => {
        assert.equal(args.where.eventType, 'receipt');
        return previousReceipts;
      },
      createMany: async (args) => { calls.custody.push(args); return { count: args.data.length }; },
    },
    location: { update: async (args) => { calls.locations.push(args); } },
    billingEvent: { createMany: async (args) => { calls.billing.push(args); return { count: args.data.length }; } },
  };
  const mocks = [
    mock.method(service, 'validateBoxLocation', async (id, tenant) => {
      assert.equal(id, locationId);
      assert.equal(tenant, tenantId);
    }),
    mock.method(billingService, 'buildBoxIntakeEvents', async (input, tenant, date, db) => {
      assert.equal(input.length, 1);
      assert.equal(tenant, tenantId);
      assert.ok(date instanceof Date);
      assert.equal(db, tx);
      if (billingError) throw new Error('Miesiąc rozliczeniowy jest zamknięty');
      return [{ sourceType: 'box_intake', sourceId: boxId, serviceCode: 'intake_box' }];
    }),
    mock.method(prisma, '$transaction', async (callback) => callback(tx)),
  ];
  return { service, calls, restore: () => mocks.reverse().forEach((entry) => entry.mock.restore()) };
}

test('receipt validates box IDs, destination ID and notes', () => {
  assert.equal(bulkBoxReceiveSchema.safeParse({ ids: [boxId], locationId }).success, true);
  assert.equal(bulkBoxReceiveSchema.safeParse({ ids: [], locationId }).success, false);
  assert.equal(bulkBoxReceiveSchema.safeParse({ ids: [boxId], locationId: 'from-typed-text' }).success, false);
  assert.equal(bulkBoxReceiveSchema.safeParse({ ids: [boxId], locationId, notes: 'x'.repeat(1001) }).success, false);
});

test('search for receivable boxes stays tenant-scoped and excludes located boxes', () => {
  const filter = buildBoxWhereSql({ search: 'K-2026-000001', unlocated: 'true', status: 'active' }, tenantId, undefined, [locationId]);
  assert.match(filter.sql, /"tenantId" =/);
  assert.match(filter.sql, /"deletedAt" IS NULL/);
  assert.match(filter.sql, /"locationId" IS NULL/);
  assert.doesNotMatch(filter.sql, /"locationId" IN/);
  assert.ok(filter.values.includes(tenantId));
});

test('intake billing uses the active rate or flags missing pricing', async () => {
  const occurredAt = new Date('2026-10-09T10:00:00.000Z');
  const rate = { id: 'rate-1', serviceCode: 'intake_box', unitPrice: new Prisma.Decimal(12), vatRate: new Prisma.Decimal(23), unit: 'box', serviceName: 'Przyjęcie' };
  let priceList = { id: 'list-1', currency: 'PLN', items: [rate] };
  const db = {
    billingPeriod: { findUnique: async ({ where }) => {
      assert.equal(where.tenantId_periodStart.tenantId, tenantId);
      assert.equal(where.tenantId_periodStart.periodStart.toISOString(), '2026-10-01T00:00:00.000Z');
      return null;
    } },
    priceList: { findFirst: async () => priceList },
  };
  const input = [{ id: boxId, boxNumber: 'K-2026-000001' }];
  const priced = await billingService.buildBoxIntakeEvents(input, tenantId, occurredAt, db);
  assert.equal(priced[0].serviceCode, 'intake_box');
  assert.equal(priced[0].sourceType, 'box_intake');
  assert.equal(priced[0].sourceId, boxId);
  assert.equal(priced[0].status, 'pending');
  assert.equal(priced[0].netAmount.toString(), '12');
  priceList = null;
  const unpriced = await billingService.buildBoxIntakeEvents(input, tenantId, occurredAt, db);
  assert.equal(unpriced[0].status, 'unpriced');
  assert.equal(unpriced[0].netAmount, null);
});

test('intake does not add charges to a closed billing month', async () => {
  const db = {
    billingPeriod: { findUnique: async () => ({ status: 'closed' }) },
    priceList: { findFirst: async () => { throw new Error('Price list must not be read'); } },
  };
  await assert.rejects(
    billingService.buildBoxIntakeEvents([{ id: boxId, boxNumber: '1' }], tenantId, new Date('2026-10-09T10:00:00Z'), db),
    /Miesiąc rozliczeniowy jest zamknięty/,
  );
});

test('receiving records location, custody and a billable intake together', async () => {
  const { service, calls, restore } = setup();
  try {
    const result = await service.bulkReceive([boxId, boxId], tenantId, locationId, userId, 'Seal intact');
    assert.equal(result.received, 1);
    assert.equal(calls.moved.length, 1);
    assert.equal(calls.locations[0].data.currentCount.increment, 1);
    assert.equal(calls.custody[0].data[0].toUserId, userId);
    assert.equal(calls.custody[0].data[0].toLocationId, locationId);
    assert.equal(calls.custody[0].data[0].notes, 'Seal intact');
    assert.equal(calls.billing[0].data[0].serviceCode, 'intake_box');
  } finally { restore(); }
});

test('foreign, located and previously received boxes cannot be received', async () => {
  for (const options of [
    { boxes: [] },
    { boxes: [{ id: boxId, boxNumber: '1', status: 'active', locationId }] },
    { boxes: [{ id: boxId, boxNumber: '1', status: 'disposed', locationId: null }] },
    { previousReceipts: [{ boxId }] },
  ]) {
    const { service, calls, restore } = setup(options);
    try {
      await assert.rejects(service.bulkReceive([boxId], tenantId, locationId, userId));
      assert.equal(calls.moved.length, 0);
      assert.equal(calls.billing.length, 0);
    } finally { restore(); }
  }
});

test('stale box state and billing errors stop the receipt before custody is written', async () => {
  for (const options of [{ updateCount: 0 }, { billingError: true }]) {
    const { service, calls, restore } = setup(options);
    try {
      await assert.rejects(service.bulkReceive([boxId], tenantId, locationId, userId));
      assert.equal(calls.custody.length, 0);
      assert.equal(calls.billing.length, 0);
    } finally { restore(); }
  }
});
