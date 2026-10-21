const test = require('node:test');
const assert = require('node:assert/strict');
const { mock } = require('node:test');
const { recognizeScan, scanKind } = require('../dist/modules/import-export/scan-ocr.service');
const { importService } = require('../dist/modules/import-export/import.service');
const { transferListService } = require('../dist/modules/transfer-lists/transfer-list.service');
const { draftScanRows, draftScanPages } = require('../../client/src/pages/scan-import.util.ts');

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

test('requires explicit acknowledgement for empty pages and never truncates the 501st item', () => {
  const first = 'A/1; Umowy; B10';
  assert.deepEqual(draftScanPages([first, ''], []).missingPage, 2);
  const reviewed = draftScanPages([first, ''], [2]);
  assert.equal(reviewed.rows.length, 1);
  assert.equal(reviewed.rows[0].sourcePage, 1);
  const overflow = draftScanPages([Array.from({ length: 501 }, (_, index) => `A/${index}; Umowy; B10`).join('\n')], []);
  assert.equal(overflow.tooMany, true);
  assert.equal(overflow.rows.length, 0);
});

test('maps the supplied nine-column transfer-list layout and joins a continued title', () => {
  const header = 'Lp.; Znak teczki; Tytuł teczki lub tomu; Daty skrajne od –do; Kat. akt; Liczba teczek; Miejsce przechowy-wania akt w archiwum; Data zniszczenia lub przekazania do Archiwum Państwowego; Numer kartonu';
  const firstPage = `${header}\n1; A/1; Dokumentacja zarządu; 2020-2024; B10; 1; Magazyn; ; 7\n; ; i uchwały wspólnoty; ; ; ; ; ; `;
  const secondPage = '2; A/2; Akta finansowe; brak dat; B50; 1; Magazyn; ; 8';
  const result = draftScanPages([firstPage, secondPage], []);
  assert.equal(result.missingPage, null);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].folderTitle, 'Dokumentacja zarządu i uchwały wspólnoty');
  assert.equal(result.rows[0].dateFrom, '2020-01-01');
  assert.equal(result.rows[0].dateTo, '2024-12-31');
  assert.equal(result.rows[0].categoryCode, 'B10');
  assert.equal(result.rows[0].boxNumber, '7');
  assert.equal(result.rows[1].sourcePage, 2);
  assert.equal(result.rows[1].dateRangeUnknown, true);
  assert.equal(result.rows[1].boxNumber, '8');
});

test('leaves ambiguous OCR categories and invalid dates for manual correction', () => {
  const header = 'Lp.; Znak teczki; Tytuł teczki lub tomu; Daty skrajne; Kat. akt';
  const rows = draftScanRows(`${header}\n1; A/1; Akta zarządu; 0020-2024; B1O\n2; A/2; Umowy; 2020-2024; B10`);
  assert.equal(rows[0].folderSignature, 'A/1');
  assert.equal(rows[0].categoryCode, '');
  assert.equal(rows[0].dateFrom, '');
  assert.equal(rows[0].dateTo, '');
  assert.equal(rows[1].categoryCode, 'B10');
  assert.equal(rows[1].dateFrom, '2020-01-01');
});

test('joins an indented continuation but keeps a new incomplete entry separate', () => {
  const rows = draftScanRows('A/1; Umowy; B10\n    i aneksy\nA/2; Wiersz bez kategorii');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].folderTitle, 'Umowy i aneksy');
  assert.equal(rows[1].categoryCode, '');
});
