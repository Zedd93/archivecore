const test = require('node:test');
const assert = require('node:assert/strict');
const { recognizeScan, scanKind } = require('../dist/modules/import-export/scan-ocr.service');
const { importService } = require('../dist/modules/import-export/import.service');
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
});

test('creates conservative draft rows and leaves uncertain categories for review', () => {
  const rows = draftScanRows('Znak teczki; Tytuł teczki; Kat. akt\n1; A/1; Umowy Łódź; B10\nA/2  Tytuł bez kategorii  2020');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].folderSignature, 'A/1');
  assert.equal(rows[0].folderTitle, 'Umowy Łódź');
  assert.equal(rows[0].categoryCode, 'B10');
  assert.equal(rows[1].categoryCode, '');
});
