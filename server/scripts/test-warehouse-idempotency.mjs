import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Prisma } = require('@prisma/client');
const { prisma } = require('../dist/config/database.js');
const { executeWarehouseOperation } = require('../dist/modules/boxes/warehouse-operation.service.js');

const tenantId = '1f11541e-00c7-4bbd-8059-bbb7d189a013';
const userId = '39b9500e-71b6-4fc4-bf3a-9a0a5f4b698b';
const locationId = '08675a3a-8a69-477a-82f1-b52d74b97bde';
const boxId = 'a07ca020-f00e-485c-9d01-f9ed697e2f40';
const operationId = '1ccdc011-533f-4728-8f82-cd548a2637f0';

function setup() {
  const rows = new Map();
  const calls = { writes: 0, validations: 0 };
  let transactionOverride = null;
  const originalOperations = prisma.warehouseOperation;
  prisma.warehouseOperation = { findUnique: async ({ where }) => rows.get(where.id) ?? null };
  const tx = {
    warehouseOperation: {
      create: async ({ data }) => {
        if (rows.has(data.id)) throw new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '5.22.0' });
        rows.set(data.id, { ...data, response: null });
      },
      update: async ({ where, data }) => { rows.set(where.id, { ...rows.get(where.id), ...data }); },
    },
  };
  const mocks = [
    mock.method(prisma, '$transaction', async (callback) => {
      if (transactionOverride) return transactionOverride();
      const before = new Map(rows);
      try { return await callback(tx); }
      catch (error) { rows.clear(); for (const [key, row] of before) rows.set(key, row); throw error; }
    }),
  ];
  const input = { operationId, tenantId, userId, operationType: 'receive', ids: [boxId], locationId };
  const validate = async () => { calls.validations++; };
  const execute = async () => { calls.writes++; return { received: 1 }; };
  return { rows, calls, input, validate, execute, overrideTransaction: (fn) => { transactionOverride = fn; }, restore: () => { mocks.reverse().forEach((entry) => entry.mock.restore()); prisma.warehouseOperation = originalOperations; } };
}

test('replaying a completed intake returns its result without custody or billing writes', async () => {
  const fixture = setup();
  try {
    assert.deepEqual(await executeWarehouseOperation(fixture.input, fixture.execute, fixture.validate), { received: 1 });
    assert.deepEqual(await executeWarehouseOperation(fixture.input, fixture.execute, fixture.validate), { received: 1, replayed: true });
    assert.equal(fixture.calls.writes, 1);
    assert.equal(fixture.calls.validations, 1);
    assert.equal(fixture.rows.size, 1);
  } finally { fixture.restore(); }
});

test('an operation ID cannot be reused for another tenant, user or payload', async () => {
  const fixture = setup();
  try {
    await executeWarehouseOperation(fixture.input, fixture.execute, fixture.validate);
    for (const change of [{ tenantId: '5af478ea-6e56-4f2b-a7b7-fdc56852116b' }, { userId: 'f3a5d77b-baf0-43f1-b10c-e07d76145154' }, { locationId: '4e0c4519-9d2f-4c0c-8d7f-e8abebf22667' }, { operationType: 'move' }]) {
      await assert.rejects(executeWarehouseOperation({ ...fixture.input, ...change }, fixture.execute, fixture.validate), { statusCode: 409 });
    }
    assert.equal(fixture.calls.writes, 1);
  } finally { fixture.restore(); }
});

test('a failed transaction leaves no completed operation to replay', async () => {
  const fixture = setup();
  try {
    await assert.rejects(executeWarehouseOperation(fixture.input, async () => { throw new Error('billing failed'); }, fixture.validate), /billing failed/);
    assert.equal(fixture.rows.size, 0);
    assert.deepEqual(await executeWarehouseOperation(fixture.input, fixture.execute, fixture.validate), { received: 1 });
  } finally { fixture.restore(); }
});

test('a concurrent request that loses the unique-key race replays the winner', async () => {
  const fixture = setup();
  try {
    // Use a real first execution to obtain the canonical payload hash.
    await executeWarehouseOperation(fixture.input, fixture.execute, fixture.validate);
    const row = fixture.rows.get(operationId);
    fixture.rows.delete(operationId);
    fixture.overrideTransaction(async () => {
      fixture.rows.set(operationId, row);
      throw new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '5.22.0' });
    });
    assert.deepEqual(await executeWarehouseOperation(fixture.input, fixture.execute, fixture.validate), { received: 1, replayed: true });
    assert.equal(fixture.calls.writes, 1);
  } finally { fixture.restore(); }
});
