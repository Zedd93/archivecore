import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { generateQrData } = require('../../shared/src/utils/qr.ts');
const { prisma } = require('../dist/config/database.js');
const { InventoryService } = require('../dist/modules/inventory/inventory.service.js');

const sessionId = '52b90a57-849b-4d21-b62f-08cdfebcf383';
const tenantId = '1f11541e-00c7-4bbd-8059-bbb7d189a013';
const userId = '39b9500e-71b6-4fc4-bf3a-9a0a5f4b698b';
const boxId = 'a07ca020-f00e-485c-9d01-f9ed697e2f40';
const scanId = 'ad1b10ae-cb3a-40eb-96ab-5ba4f8c66f39';
const code = generateQrData('DOX', 'K-2026-000001');

function setup({ status = 'in_progress', boxExists = true, duplicate = false, latestScanId = scanId } = {}) {
  const calls = { created: [], voided: [], finished: [] };
  const service = new InventoryService();
  const tx = {
    $queryRaw: async () => [{ status }],
    box: { findFirst: async (args) => {
      assert.equal(args.where.tenantId, tenantId);
      assert.equal(args.where.qrCode, code);
      return boxExists ? { id: boxId, qrCode: code, boxNumber: 'K-2026-000001', title: 'Records', locationId: null } : null;
    } },
    inventoryScan: {
      findFirst: async (args) => args.where.boxId ? (duplicate ? { id: scanId } : null) : { id: latestScanId },
      create: async (args) => { calls.created.push(args); return { id: scanId }; },
      updateMany: async (args) => { calls.voided.push(args); return { count: 1 }; },
    },
    inventorySession: {
      update: async (args) => { calls.finished.push(args); return { id: sessionId }; },
    },
  };
  const mocks = [
    mock.method(prisma, '$transaction', async (callback) => callback(tx)),
    mock.method(service, 'getSession', async () => ({ id: sessionId })),
  ];
  return { service, calls, restore: () => mocks.reverse().forEach((entry) => entry.mock.restore()) };
}

test('a valid tenant-scoped QR adds exactly one scan', async () => {
  const { service, calls, restore } = setup();
  try {
    await service.scanBox(sessionId, tenantId, code, userId);
    assert.equal(calls.created.length, 1);
    assert.equal(calls.created[0].data.boxId, boxId);
    assert.equal(calls.created[0].data.scannedById, userId);
  } finally { restore(); }
});

test('duplicate and foreign-tenant boxes cannot be recorded', async () => {
  for (const options of [{ duplicate: true }, { boxExists: false }]) {
    const { service, calls, restore } = setup(options);
    try {
      await assert.rejects(service.scanBox(sessionId, tenantId, code, userId));
      assert.equal(calls.created.length, 0);
    } finally { restore(); }
  }
});

test('completed sessions reject scans and scan voids', async () => {
  const { service, calls, restore } = setup({ status: 'completed' });
  try {
    await assert.rejects(service.scanBox(sessionId, tenantId, code, userId), /już zakończona/);
    await assert.rejects(service.undoScan(sessionId, scanId, tenantId, userId), /już zakończona/);
    assert.equal(calls.created.length, 0);
    assert.equal(calls.voided.length, 0);
  } finally { restore(); }
});

test('undo keeps an audit trail and finish records the operator', async () => {
  const { service, calls, restore } = setup();
  try {
    await service.undoScan(sessionId, scanId, tenantId, userId);
    assert.equal(calls.voided[0].where.sessionId, sessionId);
    assert.equal(calls.voided[0].data.voidedById, userId);
    assert.ok(calls.voided[0].data.voidedAt instanceof Date);
    await service.finishSession(sessionId, tenantId, userId);
    assert.equal(calls.finished[0].data.status, 'completed');
    assert.equal(calls.finished[0].data.finishedById, userId);
  } finally { restore(); }
});

test('undo rejects a stale scan when another operator scanned later', async () => {
  const { service, calls, restore } = setup({ latestScanId: boxId });
  try {
    await assert.rejects(service.undoScan(sessionId, scanId, tenantId, userId), /Lista skanów zmieniła się/);
    assert.equal(calls.voided.length, 0);
  } finally { restore(); }
});
