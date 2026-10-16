import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import QRCode from 'qrcode';
import qr from '../../shared/src/utils/qr.ts';

const { ScanBatchService } = await import('../src/modules/attachments/scan-batch.service.ts');
const { generateFolderQrData } = qr;
const folderA = '11111111-1111-4111-8111-111111111111';
const folderB = '22222222-2222-4222-8222-222222222222';
const codes = [generateFolderQrData(folderA), null, null, generateFolderQrData(folderB), null];

async function makeFile(withQrImages = false, unreadablePages = []) {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < codes.length; index++) {
    const page = pdf.addPage([500 + index, 700]);
    if (withQrImages && codes[index] && !unreadablePages.includes(index + 1)) {
      const image = await pdf.embedPng(await QRCode.toBuffer(codes[index], { width: 400, margin: 3 }));
      page.drawImage(image, { x: 50, y: 200, width: 400, height: 400 });
    } else {
      page.drawText(`Document page ${index + 1}`, { x: 50, y: 400 });
    }
  }
  const buffer = Buffer.from(await pdf.save());
  return { buffer, originalname: 'wsad.pdf', mimetype: 'application/pdf', size: buffer.length };
}

function makeDb({ allowedIds = [folderA, folderB], failCreate = false } = {}) {
  const created = [];
  let lastFolderWhere;
  const db = {
    folder: {
      findMany: async ({ where }) => {
        lastFolderWhere = where;
        assert.equal(where.tenantId, 'tenant-a');
        assert.equal(where.status, 'active');
        return where.id.in.filter((id) => allowedIds.includes(id)).map((id) => ({ id, folderNumber: id === folderA ? 'T-1' : 'T-2', title: id === folderA ? 'Akta A' : 'Akta B' }));
      },
    },
    $transaction: async (callback) => callback({ attachment: {
      create: async ({ data }) => {
        if (failCreate) throw new Error('db failed');
        created.push(data);
        return { id: `attachment-${created.length}`, folderId: data.folderId, fileName: data.fileName };
      },
    } }),
  };
  return { db, created, getLastFolderWhere: () => lastFolderWhere };
}

test('scan batch preview splits at folder QR pages and checks tenant and department', async () => {
  const { db, getLastFolderWhere } = makeDb();
  const service = new ScanBatchService(db, { uploadFile: async () => {}, deleteFile: async () => {} }, async () => codes);
  const preview = await service.preview(await makeFile(), 'tenant-a', 'Księgowość');
  assert.equal(preview.pageCount, 5);
  assert.deepEqual(preview.segments.map(({ folderId, coverPage, firstPage, lastPage }) => ({ folderId, coverPage, firstPage, lastPage })), [
    { folderId: folderA, coverPage: 1, firstPage: 2, lastPage: 3 },
    { folderId: folderB, coverPage: 4, firstPage: 5, lastPage: 5 },
  ]);
  assert.match(preview.checksumSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(getLastFolderWhere().box, { department: { equals: 'Księgowość', mode: 'insensitive' } });
});

test('scan batch rejects missing or invalid QR, empty segments and inaccessible folders', async () => {
  const file = await makeFile();
  const storage = { uploadFile: async () => { throw new Error('should not upload'); }, deleteFile: async () => {} };
  const { db } = makeDb();
  for (const pageCodes of [
    [null, ...codes.slice(1)],
    ['not-a-folder', ...codes.slice(1)],
    [codes[0], codes[3], null, null, null],
  ]) {
    await assert.rejects(new ScanBatchService(db, storage, async () => pageCodes).preview(file, 'tenant-a'));
  }
  const inaccessible = makeDb({ allowedIds: [folderA] });
  await assert.rejects(new ScanBatchService(inaccessible.db, storage, async () => codes).preview(file, 'tenant-a'), { statusCode: 403 });
});

test('manual separator recovers a missing or unreadable QR without overriding a valid code', async () => {
  const file = await makeFile();
  const { db } = makeDb();
  const missingFirst = [null, null, null, codes[3], null];
  const service = new ScanBatchService(db, { uploadFile: async () => {}, deleteFile: async () => {} }, async () => missingFirst);
  await assert.rejects(service.preview(file, 'tenant-a'), { statusCode: 422 });
  const preview = await service.preview(file, 'tenant-a', undefined, JSON.stringify([{ page: 1, folderId: folderA }]));
  assert.deepEqual(preview.segments.map(({ folderId, source, coverPage }) => ({ folderId, source, coverPage })), [
    { folderId: folderA, source: 'manual', coverPage: 1 },
    { folderId: folderB, source: 'qr', coverPage: 4 },
  ]);
  assert.match(preview.planHash, /^[a-f0-9]{64}$/);

  const unreadable = new ScanBatchService(db, { uploadFile: async () => {}, deleteFile: async () => {} }, async () => [codes[0], null, null, 'ACF:bad:code', null]);
  await assert.rejects(unreadable.preview(file, 'tenant-a'), { statusCode: 422 });
  const repaired = await unreadable.preview(file, 'tenant-a', undefined, [{ page: 4, folderId: folderB }]);
  assert.equal(repaired.segments[1].source, 'manual');
  await assert.rejects(new ScanBatchService(db, { uploadFile: async () => {}, deleteFile: async () => {} }, async () => codes)
    .preview(file, 'tenant-a', undefined, [{ page: 4, folderId: folderA }]), { statusCode: 409 });
});

test('manual separators reject duplicate, out-of-range and unauthorized selections', async () => {
  const file = await makeFile();
  const { db } = makeDb({ allowedIds: [folderA] });
  const service = new ScanBatchService(db, { uploadFile: async () => {}, deleteFile: async () => {} }, async () => [null, null, null, null, null]);
  await assert.rejects(service.preview(file, 'tenant-a', undefined, [{ page: 1, folderId: folderA }, { page: 1, folderId: folderB }]), { statusCode: 400 });
  await assert.rejects(service.preview(file, 'tenant-a', undefined, [{ page: 6, folderId: folderA }]), { statusCode: 400 });
  await assert.rejects(service.preview(file, 'tenant-a', undefined, [{ page: 1, folderId: folderB }]), { statusCode: 403 });
  await assert.rejects(service.preview(file, 'tenant-a', undefined, '[{"page":"1","folderId":"not-a-uuid"}]'), { statusCode: 400 });
});

test('manual assignment cannot change between preview and commit', async () => {
  const file = await makeFile();
  const { db, created } = makeDb();
  const uploaded = [];
  const service = new ScanBatchService(db, { uploadFile: async (key) => { uploaded.push(key); }, deleteFile: async () => {} }, async () => [codes[0], null, null, null, null]);
  const reviewed = [{ page: 4, folderId: folderB }];
  const preview = await service.preview(file, 'tenant-a', undefined, reviewed);
  await assert.rejects(service.commit(file, 'tenant-a', 'user-a', preview.checksumSha256, undefined, reviewed), { statusCode: 409 });
  await assert.rejects(service.commit(file, 'tenant-a', 'user-a', preview.checksumSha256, undefined, [{ page: 4, folderId: folderA }], preview.planHash), { statusCode: 409 });
  assert.equal(uploaded.length, 0);
  const result = await service.commit(file, 'tenant-a', 'user-a', preview.checksumSha256, undefined, JSON.stringify(reviewed), preview.planHash);
  assert.equal(result.attachments.length, 2);
  assert.deepEqual(created.map((item) => item.folderId), [folderA, folderB]);
});

test('scan batch commits separate PDFs only after matching the reviewed checksum', async () => {
  const file = await makeFile();
  const { db, created } = makeDb();
  const uploaded = [];
  const storage = { uploadFile: async (key, bytes) => uploaded.push({ key, bytes }), deleteFile: async () => {} };
  const service = new ScanBatchService(db, storage, async () => codes);
  await assert.rejects(service.commit(file, 'tenant-a', 'user-a', '0'.repeat(64)), { statusCode: 409 });
  assert.equal(uploaded.length, 0);
  const preview = await service.preview(file, 'tenant-a');
  const result = await service.commit(file, 'tenant-a', 'user-a', preview.checksumSha256);
  assert.equal(result.attachments.length, 2);
  assert.deepEqual(created.map((item) => item.folderId), [folderA, folderB]);
  assert.ok(created.every((item) => item.tenantId === 'tenant-a' && item.uploadedBy === 'user-a'));
  assert.deepEqual(await Promise.all(uploaded.map(async ({ bytes }) => {
    const pdf = await PDFDocument.load(bytes);
    return pdf.getPages().map((page) => page.getWidth());
  })), [[501, 502], [504]]);
});

test('scan batch cleans up uploaded objects when later storage or database work fails', async () => {
  const file = await makeFile();
  for (const failure of ['storage', 'database']) {
    const { db } = makeDb({ failCreate: failure === 'database' });
    const uploaded = [];
    const deleted = [];
    const storage = {
      uploadFile: async (key) => {
        if (failure === 'storage' && uploaded.length === 1) throw new Error('storage failed');
        uploaded.push(key);
      },
      deleteFile: async (key) => { deleted.push(key); },
    };
    const service = new ScanBatchService(db, storage, async () => codes);
    const preview = await service.preview(file, 'tenant-a');
    await assert.rejects(service.commit(file, 'tenant-a', 'user-a', preview.checksumSha256));
    assert.equal(deleted.length, failure === 'storage' ? uploaded.length + 1 : uploaded.length);
    assert.deepEqual(deleted.slice(0, uploaded.length), uploaded);
  }
});

test('real PDF rendering recognizes ArchiveCore folder QR labels', { skip: process.env.SCAN_BATCH_RENDER_TEST !== '1' }, async () => {
  const file = await makeFile(true);
  const { db } = makeDb();
  const service = new ScanBatchService(db);
  const preview = await service.preview(file, 'tenant-a');
  assert.deepEqual(preview.segments.map((segment) => segment.folderId), [folderA, folderB]);
});

test('real PDF rendering supports a manually identified unreadable cover page', { skip: process.env.SCAN_BATCH_RENDER_TEST !== '1' }, async () => {
  const file = await makeFile(true, [4]);
  const { db } = makeDb();
  const service = new ScanBatchService(db);
  const preview = await service.preview(file, 'tenant-a', undefined, [{ page: 4, folderId: folderB }]);
  assert.deepEqual(preview.segments.map(({ folderId, source, firstPage, lastPage }) => ({ folderId, source, firstPage, lastPage })), [
    { folderId: folderA, source: 'qr', firstPage: 2, lastPage: 3 },
    { folderId: folderB, source: 'manual', firstPage: 5, lastPage: 5 },
  ]);
});
