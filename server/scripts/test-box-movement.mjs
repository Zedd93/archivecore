import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { prisma } = require('../dist/config/database.js');
const { BoxService, boxService } = require('../dist/modules/boxes/box.service.js');
const { BoxController } = require('../dist/modules/boxes/box.controller.js');
const { custodyService } = require('../dist/modules/orders/custody.service.js');

const tenantId = '1f11541e-00c7-4bbd-8059-bbb7d189a013';
const firstId = 'a07ca020-f00e-485c-9d01-f9ed697e2f40';
const secondId = 'a07ca020-f00e-485c-9d01-f9ed697e2f41';
const thirdId = 'a07ca020-f00e-485c-9d01-f9ed697e2f42';
const sourceId = '08675a3a-8a69-477a-82f1-b52d74b97bde';
const destinationId = '08675a3a-8a69-477a-82f1-b52d74b97bdf';
const userId = '39b9500e-71b6-4fc4-bf3a-9a0a5f4b698b';

function setup(boxes, staleSource = undefined) {
  const service = new BoxService();
  const calls = { updates: [], locations: [], events: [] };
  const tx = {
    box: {
      findMany: async () => boxes,
      updateMany: async (args) => {
        calls.updates.push(args);
        const count = staleSource !== undefined && args.where.locationId === staleSource ? 0 : args.where.id.in.length;
        return { count };
      },
    },
    location: { update: async (args) => { calls.locations.push(args); } },
    custodyEvent: { createMany: async (args) => { calls.events.push(...args.data); } },
  };
  const mocks = [
    mock.method(service, 'validateBoxLocation', async (id, tenant) => {
      assert.equal(id, destinationId);
      assert.equal(tenant, tenantId);
    }),
    mock.method(prisma, '$transaction', async (callback) => callback(tx)),
  ];
  return { service, calls, restore: () => mocks.reverse().forEach((entry) => entry.mock.restore()) };
}

test('bulk movement records one custody event per moved box and correct location counts', async () => {
  const boxes = [
    { id: firstId, locationId: sourceId },
    { id: secondId, locationId: null },
    { id: thirdId, locationId: destinationId },
  ];
  const { service, calls, restore } = setup(boxes);
  try {
    const result = await service.bulkMove([firstId, secondId, thirdId, firstId], tenantId, destinationId, userId, 'Moved together');
    assert.deepEqual(result, { updated: 3, moved: 2 });
    assert.equal(calls.updates.length, 2);
    assert.deepEqual(calls.updates.map((item) => item.where.locationId), [sourceId, null]);
    assert.ok(calls.updates.every((item) => item.where.tenantId === tenantId));
    assert.deepEqual(calls.locations.map((item) => item.data.currentCount), [{ decrement: 1 }, { increment: 2 }]);
    assert.deepEqual(calls.events.map((item) => [item.boxId, item.fromLocationId, item.toLocationId, item.toUserId, item.notes]), [
      [firstId, sourceId, destinationId, userId, 'Moved together'],
      [secondId, null, destinationId, userId, 'Moved together'],
    ]);
  } finally { restore(); }
});

test('moving boxes already at destination is a no-op', async () => {
  const { service, calls, restore } = setup([{ id: firstId, locationId: destinationId }]);
  try {
    assert.deepEqual(await service.bulkMove([firstId], tenantId, destinationId, userId), { updated: 1, moved: 0 });
    assert.equal(calls.updates.length, 0);
    assert.equal(calls.locations.length, 0);
    assert.equal(calls.events.length, 0);
  } finally { restore(); }
});

test('stale source location prevents counters and custody writes', async () => {
  const { service, calls, restore } = setup([{ id: firstId, locationId: sourceId }], sourceId);
  try {
    await assert.rejects(service.bulkMove([firstId], tenantId, destinationId, userId), /Lokalizacja części kartonów zmieniła się/);
    assert.equal(calls.locations.length, 0);
    assert.equal(calls.events.length, 0);
  } finally { restore(); }
});

test('single movement updates location, counters and custody in one transaction', async () => {
  const service = new BoxService();
  const calls = { updates: [], locations: [], events: [] };
  const tx = {
    box: {
      updateMany: async (args) => { calls.updates.push(args); return { count: 1 }; },
      findUniqueOrThrow: async () => ({ id: firstId, locationId: destinationId }),
    },
    location: { update: async (args) => { calls.locations.push(args); } },
    custodyEvent: { create: async (args) => { calls.events.push(args.data); } },
  };
  const mocks = [
    mock.method(service, 'validateBoxLocation', async () => {}),
    mock.method(service, 'getById', async (id, tenant, department) => {
      assert.deepEqual([id, tenant, department], [firstId, tenantId, 'Finanse']);
      return { id: firstId, locationId: sourceId, status: 'active' };
    }),
    mock.method(prisma, '$transaction', async (callback) => callback(tx)),
  ];
  try {
    const result = await service.move(firstId, tenantId, destinationId, userId, 'Rearranged', 'Finanse');
    assert.equal(result.locationId, destinationId);
    assert.equal(calls.updates[0].where.locationId, sourceId);
    assert.equal(calls.updates[0].where.department.equals, 'Finanse');
    assert.deepEqual(calls.locations.map((item) => item.data.currentCount), [{ decrement: 1 }, { increment: 1 }]);
    assert.deepEqual(calls.events[0], {
      boxId: firstId, eventType: 'transfer', fromLocationId: sourceId,
      toLocationId: destinationId, toUserId: userId, notes: 'Rearranged',
    });
  } finally { mocks.reverse().forEach((entry) => entry.mock.restore()); }
});

test('editing a box location also records movement atomically', async () => {
  const service = new BoxService();
  const calls = { updates: [], locations: [], events: [] };
  const tx = {
    box: {
      updateMany: async (args) => { calls.updates.push(args); return { count: 1 }; },
      findUniqueOrThrow: async () => ({ id: firstId, locationId: destinationId }),
    },
    location: { update: async (args) => { calls.locations.push(args); } },
    custodyEvent: { create: async (args) => { calls.events.push(args.data); } },
  };
  const mocks = [
    mock.method(service, 'validateBoxLocation', async () => {}),
    mock.method(service, 'getById', async (id, tenant, department) => {
      assert.deepEqual([id, tenant, department], [firstId, tenantId, 'Finanse']);
      return { id: firstId, locationId: sourceId, status: 'active' };
    }),
    mock.method(prisma, '$transaction', async (callback) => callback(tx)),
  ];
  try {
    const result = await service.update(firstId, tenantId, { title: 'Nowy tytuł', locationId: destinationId }, userId, 'Finanse');
    assert.equal(result.locationId, destinationId);
    assert.equal(calls.updates[0].where.locationId, sourceId);
    assert.equal(calls.updates[0].where.department.equals, 'Finanse');
    assert.equal(calls.updates[0].data.title, 'Nowy tytuł');
    assert.deepEqual(calls.locations.map((item) => item.data.currentCount), [{ decrement: 1 }, { increment: 1 }]);
    assert.equal(calls.events[0].fromLocationId, sourceId);
    assert.equal(calls.events[0].toLocationId, destinationId);
    assert.equal(calls.events[0].toUserId, userId);
  } finally { mocks.reverse().forEach((entry) => entry.mock.restore()); }
});

test('movement history checks tenant and department access before reading events', async () => {
  const controller = new BoxController();
  const requests = [];
  const mocks = [
    mock.method(boxService, 'getById', async (id, tenant, department) => {
      requests.push([id, tenant, department]);
      return { id };
    }),
    mock.method(custodyService, 'getTransfersByBox', async (id, tenant, department) => {
      requests.push([id, tenant, department]);
      return [{ id: 'event-1' }];
    }),
  ];
  const req = { params: { id: firstId }, tenantId, accessDepartment: 'Finanse' };
  const res = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  try {
    await controller.getCustody(req, res, (error) => { throw error; });
    assert.deepEqual(requests, [[firstId, tenantId, 'Finanse'], [firstId, tenantId, 'Finanse']]);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data[0].id, 'event-1');
  } finally { mocks.reverse().forEach((entry) => entry.mock.restore()); }
});

test('movement history does not return events when box access is denied', async () => {
  const controller = new BoxController();
  let eventLookupCalled = false;
  let capturedError;
  const mocks = [
    mock.method(boxService, 'getById', async () => { throw new Error('Brak dostępu'); }),
    mock.method(custodyService, 'getTransfersByBox', async () => { eventLookupCalled = true; return []; }),
  ];
  try {
    await controller.getCustody({ params: { id: firstId }, tenantId, accessDepartment: 'Finanse' }, {}, (error) => { capturedError = error; });
    assert.match(capturedError.message, /Brak dostępu/);
    assert.equal(eventLookupCalled, false);
  } finally { mocks.reverse().forEach((entry) => entry.mock.restore()); }
});
