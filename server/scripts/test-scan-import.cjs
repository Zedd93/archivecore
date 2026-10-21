const test = require('node:test');
const assert = require('node:assert/strict');
const { mock } = require('node:test');
const { recognizeScan, scanKind } = require('../dist/modules/import-export/scan-ocr.service');
const { importService } = require('../dist/modules/import-export/import.service');
const { transferListService } = require('../dist/modules/transfer-lists/transfer-list.service');
const { draftScanRows } = require('../../client/src/pages/scan-import.util.ts');

test('rejects missing, oversized and unsupported scans before starting OCR', async () => {
  await assert.rejects(recognizeScan(Buffer.alloc(0)), /Skan musi mieć/);
  await assert.rejects(recognizeScan(Buffer.alloc(10 * 1024 * 1024 + 1)), /Skan musi mieć/);
  await assert.rejects(recognizeScan(Buffer.from('not a scan')), /Obsługiwane skany/);
});

test('recognizes scan formats by content rather than filename', () => {
  assert.equal(scanKind(Buffer.from('%PDF-1.7\n')), 'pdf');
  assert.equal(scanKind(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'png');
  assert.equal(scanKind(Buffer.from([255, 216, 255, 224])), 'jpeg');
  assert.equal(scanKind(Buffer.from([73, 73, 42, 0])), 'tiff');
  assert.throws(() => scanKind(Buffer.from('not-an-image')), /Obsługiwane skany/);
});

test('requires explicit approval and complete rows before creating a list', async () => {
  const base = {
    title: 'Spis testowy',
    items: [{ folderSignature: 'A/1', folderTitle: 'Umowy', categoryCode: 'B10' }],
  };
  await assert.rejects(importService.importReviewedScan({ ...base, confirmed: false }, 'tenant', 'user'), /Invalid literal value/);
  await assert.rejects(importService.importReviewedScan({ ...base, confirmed: true, items: [{ folderSignature: '', folderTitle: 'Umowy', categoryCode: 'B10' }] }, 'tenant', 'user'), /Pozycja 1/);
  await assert.rejects(importService.importReviewedScan({ ...base, confirmed: true, items: [] }, 'tenant', 'user'), /Array must contain/);
  await assert.rejects(importService.importReviewedScan({ ...base, confirmed: true, items: [{ ...base.items[0], dateFrom: '2020-01-01', dateRangeUnknown: true }] }, 'tenant', 'user'), /Pozycja 1: Nie można jednocześnie/);
});

test('creates conservative draft rows and leaves uncertain categories for review', () => {
  const rows = draftScanRows('Znak teczki; Tytuł teczki; Kat. akt\n1; A/1; Umowy Łódź; B10\nA/2  Tytuł bez kategorii  2020');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].folderSignature, 'A/1');
  assert.equal(rows[0].folderTitle, 'Umowy Łódź');
  assert.equal(rows[0].categoryCode, 'B10');
  assert.equal(rows[1].categoryCode, '');
});

test('drafts explicit missing dates only from a separate OCR cell before the category', () => {
  const rows = draftScanRows('A/1; Umowy Łódź; brak dat; B10\nA/2; Brak dat; B10\nA/3; Umowy; B10');
  assert.equal(rows.length, 3);
  assert.equal(rows[0].folderTitle, 'Umowy Łódź');
  assert.equal(rows[0].dateRangeUnknown, true);
  assert.equal(rows[0].dateFrom, '');
  assert.equal(rows[0].dateTo, '');
  assert.equal(rows[1].folderTitle, 'Brak dat');
  assert.equal(rows[1].dateRangeUnknown, false);
  assert.equal(rows[2].dateRangeUnknown, false);
});

test('passes reviewed missing-date markers to the transfer list import', async () => {
  let importedItems;
  const create = mock.method(transferListService, 'create', async () => ({ id: 'list-1', listNumber: 'SZO-1', title: 'Spis testowy' }));
  const importItems = mock.method(transferListService, 'importItems', async (_listId, _tenantId, _userId, items) => {
    importedItems = items;
    return { imported: items.length, errorDetails: [] };
  });
  try {
    const result = await importService.importReviewedScan({
      title: 'Spis testowy',
      confirmed: true,
      items: [
        { folderSignature: 'A/1', folderTitle: 'Brak dat w źródle', categoryCode: 'B10', dateRangeUnknown: true },
        { folderSignature: 'A/2', folderTitle: 'Daty niewypełnione', categoryCode: 'B10' },
      ],
    }, 'tenant', 'user');
    assert.equal(result.imported, 2);
    assert.equal(importedItems[0].dateRangeUnknown, true);
    assert.equal(importedItems[1].dateRangeUnknown, undefined);
  } finally {
    create.mock.restore();
    importItems.mock.restore();
  }
});
