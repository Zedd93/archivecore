import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { PDFDocument } from 'pdf-lib';

const require = createRequire(import.meta.url);
const { Prisma } = require('@prisma/client');
const { prisma } = require('../dist/config/database.js');
const { OrderScanService } = require('../dist/modules/orders/order-scan.service.js');
const { OrderService } = require('../dist/modules/orders/order.service.js');
const { billingService } = require('../dist/modules/pricing/billing.service.js');
const { notificationService } = require('../dist/modules/notifications/notification.service.js');
const { createOrderSchema } = require('../../shared/src/validators/order.schema.ts');

const tenantId = '1f11541e-00c7-4bbd-8059-bbb7d189a013';
const orderId = 'a07ca020-f00e-485c-9d01-f9ed697e2f40';
const itemId = '14a504c7-4864-4027-a02c-685201fb38f8';
const userId = '0ab09ae1-75cb-4e65-9342-8b613196271f';

async function scanPdf() {
  const document = await PDFDocument.create();
  document.addPage();
  document.addPage();
  return Buffer.from(await document.save());
}

function fixture() {
  const objects = new Map();
  let status = 'in_progress';
  let scanFile = null;
  const db = {
    orderItem: { findFirst: async ({ where }) => {
      if (where.id !== itemId || where.orderId !== orderId || where.order.tenantId !== tenantId) return null;
      return { id: itemId, order: { status }, folder: { box: { department: 'Księgowość' } }, document: null, transferListItem: null, scanFile };
    } },
    orderScanFile: { create: async ({ data }) => {
      scanFile = { id: 'scan-id', uploadedAt: new Date(), ...data };
      return scanFile;
    } },
  };
  const storage = {
    uploadFile: async (key, data) => objects.set(key, data),
    downloadFile: async (key) => objects.get(key),
    deleteFile: async (key) => objects.delete(key),
  };
  return { service: new OrderScanService(db, storage), objects, setStatus: (value) => { status = value; }, getScan: () => scanFile };
}

test('scan orders accept folders and reject whole boxes', () => {
  assert.equal(createOrderSchema.safeParse({ orderType: 'scan', items: [{ folderId: itemId }] }).success, true);
  assert.equal(createOrderSchema.safeParse({ orderType: 'scan', items: [{ boxId: itemId }] }).success, false);
});

test('upload reads actual PDF page count and rejects malformed files', async () => {
  const { service, objects, getScan } = fixture();
  const pdf = await scanPdf();
  await assert.rejects(service.upload(orderId, itemId, tenantId, userId,
    { buffer: Buffer.from('%PDF-invalid %%EOF'), mimetype: 'application/pdf', originalname: 'bad.pdf' }, 'Księgowość'), { statusCode: 400 });
  assert.equal(objects.size, 0);
  const saved = await service.upload(orderId, itemId, tenantId, userId,
    { buffer: pdf, mimetype: 'application/pdf', originalname: 'scan.pdf' }, 'Księgowość');
  assert.equal(saved.pageCount, 2);
  assert.match(getScan().storageKey, new RegExp(`^${tenantId}/order-scans/${orderId}/${itemId}/`));
  await assert.rejects(service.upload(orderId, itemId, tenantId, userId,
    { buffer: pdf, mimetype: 'application/pdf', originalname: 'again.pdf' }, 'Księgowość'), { statusCode: 409 });
});

test('download is tenant- and department-scoped and waits for delivery', async () => {
  const { service, objects, setStatus, getScan } = fixture();
  const pdf = await scanPdf();
  await service.upload(orderId, itemId, tenantId, userId,
    { buffer: pdf, mimetype: 'application/pdf', originalname: 'scan.pdf' }, 'Księgowość');
  await assert.rejects(service.download(orderId, itemId, tenantId, 'Księgowość'), { statusCode: 409 });
  setStatus('delivered');
  await assert.rejects(service.download(orderId, itemId, tenantId, 'Kadry'), { statusCode: 404 });
  await assert.rejects(service.download(orderId, itemId, 'other-tenant'), { statusCode: 404 });
  assert.deepEqual((await service.download(orderId, itemId, tenantId, 'Księgowość')).buffer, pdf);
  objects.set(getScan().storageKey, Buffer.from('tampered'));
  await assert.rejects(service.download(orderId, itemId, tenantId), /Suma kontrolna/);
});

test('scan order cannot be marked ready until each item has a PDF', async () => {
  const service = new OrderService();
  service.getById = async () => ({ orderType: 'scan', items: [{ scanFile: null }], status: 'in_progress' });
  await assert.rejects(service.markReady(orderId, tenantId, userId), { statusCode: 409 });
});

test('department order list keeps scan orders limited to its documents', async () => {
  const originalFindMany = prisma.order.findMany;
  const originalCount = prisma.order.count;
  let capturedWhere;
  prisma.order.findMany = async ({ where }) => { capturedWhere = where; return []; };
  prisma.order.count = async () => 0;
  try {
    await new OrderService().list(tenantId, { search: 'Z-1' }, 0, 20, 'Księgowość');
    assert.equal(capturedWhere.tenantId, tenantId);
    assert.equal(capturedWhere.OR[0].orderNumber.contains, 'Z-1');
    assert.equal(capturedWhere.AND[0].OR[0].orderType.not, 'scan');
    assert.equal(capturedWhere.AND[0].OR[1].items.every.OR.length, 5);
  } finally {
    prisma.order.findMany = originalFindMany;
    prisma.order.count = originalCount;
  }
});

test('scan billing uses the PDF page count, not one event per file', async () => {
  const originalFindUnique = prisma.billingPeriod.findUnique;
  const originalFindFirst = prisma.priceList.findFirst;
  prisma.billingPeriod.findUnique = async () => null;
  prisma.priceList.findFirst = async () => ({
    id: 'list-id', currency: 'PLN',
    items: [{ id: 'rate-id', serviceCode: 'scan_page', serviceName: 'Skan strony', unit: 'page', unitPrice: new Prisma.Decimal('0.50'), vatRate: new Prisma.Decimal(23) }],
  });
  try {
    const events = await billingService.buildOrderDeliveryEvents({
      id: orderId, tenantId, orderNumber: 'Z-1', orderType: 'scan',
      items: [{ id: itemId, folder: { folderNumber: '1' }, scanFile: { pageCount: 2 } }],
    }, new Date('2026-10-12T12:00:00Z'));
    assert.equal(events.length, 1);
    assert.equal(events[0].serviceCode, 'scan_page');
    assert.equal(events[0].quantity.toString(), '2');
    assert.equal(events[0].netAmount.toString(), '1');
  } finally {
    prisma.billingPeriod.findUnique = originalFindUnique;
    prisma.priceList.findFirst = originalFindFirst;
  }
});

test('delivering a scan does not move boxes or create custody events', async () => {
  const service = new OrderService();
  const order = {
    id: orderId, tenantId, orderNumber: 'Z-1', orderType: 'scan', status: 'ready',
    requestedBy: userId, approvedBy: null, assignedTo: null, notes: null,
    items: [{ id: itemId, itemStatus: 'pending', folder: { box: { id: 'physical-box' } }, scanFile: { pageCount: 2 } }],
  };
  service.getById = async () => order;
  const originals = {
    build: billingService.buildOrderDeliveryEvents,
    orderUpdate: prisma.order.update,
    itemUpdate: prisma.orderItem.updateMany,
    custodyCreate: prisma.custodyEvent.createMany,
    boxUpdate: prisma.box.updateMany,
    transaction: prisma.$transaction,
    notify: notificationService.notifyTenantUsers,
  };
  let updatedItems = 0;
  let webhookPayload;
  billingService.buildOrderDeliveryEvents = async () => [];
  prisma.order.update = async () => order;
  prisma.orderItem.updateMany = async () => { updatedItems++; return { count: 1 }; };
  prisma.custodyEvent.createMany = async () => { throw new Error('unexpected custody event'); };
  prisma.box.updateMany = async () => { throw new Error('unexpected box movement'); };
  prisma.$transaction = async (callback) => callback({
    order: { update: prisma.order.update },
    orderItem: { updateMany: prisma.orderItem.updateMany },
    webhookEndpoint: { findMany: async () => [{ id: 'endpoint-a' }] },
    webhookDelivery: { createMany: async ({ data }) => { webhookPayload = JSON.parse(data[0].payloadText); return { count: 1 }; } },
  });
  notificationService.notifyTenantUsers = async () => undefined;
  try {
    await service.deliver(orderId, tenantId, userId);
    assert.equal(updatedItems, 1);
    assert.equal(webhookPayload.data.status, 'delivered');
    assert.equal(webhookPayload.data.orderType, 'scan');
  } finally {
    billingService.buildOrderDeliveryEvents = originals.build;
    prisma.order.update = originals.orderUpdate;
    prisma.orderItem.updateMany = originals.itemUpdate;
    prisma.custodyEvent.createMany = originals.custodyCreate;
    prisma.box.updateMany = originals.boxUpdate;
    prisma.$transaction = originals.transaction;
    notificationService.notifyTenantUsers = originals.notify;
  }
});
