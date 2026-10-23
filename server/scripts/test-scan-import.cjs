const test = require('node:test');
const assert = require('node:assert/strict');
const { mock } = require('node:test');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const { recognizeScan, scanKind } = require('../dist/modules/import-export/scan-ocr.service');
const { importService } = require('../dist/modules/import-export/import.service');
const { transferListService } = require('../dist/modules/transfer-lists/transfer-list.service');
const { prisma } = require('../dist/config/database');
const { errorHandler } = require('../dist/middleware/error-handler');
const { correctScanSourceOrdinal, draftScanRows, draftScanPages, invalidScanDateRange, needsScanDateReview, scanBoxNumbers, scanContentDuplicateGroups, scanExpectedRowCountStatus, scanOrdinalIssueLocations, scanOrdinalIssues, validFolderCount, validScanBoxNumber, validScanSourceOrdinal } = require('../../client/src/pages/scan-import.util.ts');

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

test('reads a text-based PDF without external Poppler or OCR programs', async () => {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const first = document.addPage();
  first.drawText('Lp. Znak teczki Tytul teczki lub tomu Daty skrajne Kat. akt Liczba teczek', { x: 40, y: 700, font, size: 10 });
  first.drawText('1 TEST/1 Umowy 2010-2012 B5 46', { x: 40, y: 680, font, size: 10 });
  const second = document.addPage();
  second.drawText('Przekazujacy akta Kierownik Komorki Organizacyjnej Przyjmujacy akta', { x: 40, y: 700, font, size: 10 });
  const buffer = Buffer.from(await document.save());
  const pageOne = await recognizeScan(buffer, 1);
  const pageTwo = await recognizeScan(buffer, 2);
  assert.equal(pageOne.pages, 2);
  assert.equal(pageTwo.pages, 2);
  assert.deepEqual(pageOne.pageDiagnostics, [{ page: 1, source: 'embedded', reviewFlag: null }]);
  assert.deepEqual(pageTwo.pageDiagnostics, [{ page: 2, source: 'embedded', reviewFlag: null }]);
  const preview = draftScanPages([pageOne.text, pageTwo.text], [2]);
  assert.equal(preview.rows.length, 1);
  assert.equal(preview.rows[0].folderSignature, 'TEST/1');
  assert.equal(preview.rows[0].sourceOrdinal, 1);
  assert.equal(preview.rows[0].dateTo, '2012-12-31');
  assert.equal(preview.rows[0].folderCount, '46');
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
  await assert.rejects(importService.importReviewedScan({ ...base, confirmed: true, items: [{ ...base.items[0], folderCount: 0 }] }, 'tenant', 'user'), /Pozycja 1:/);
  await assert.rejects(importService.importReviewedScan({ ...base, confirmed: true, items: [{ ...base.items[0], dateFrom: '2025-01-01', dateTo: '2024-12-31' }] }, 'tenant', 'user'), /Pozycja 1: Data końcowa nie może być wcześniejsza/);
  await assert.rejects(importService.importReviewedScan({ ...base, confirmed: true, items: [{ ...base.items[0], dateFrom: '2025-02-29' }] }, 'tenant', 'user'), /Pozycja 1: Data nie istnieje w kalendarzu/);
  await assert.rejects(importService.importReviewedScan({ ...base, confirmed: true, items: [{ ...base.items[0], dateTo: '2024-02-31' }] }, 'tenant', 'user'), /Pozycja 1: Data nie istnieje w kalendarzu/);
});

test('rejects reversed scan date ranges but allows equal and partial dates in the preview', () => {
  const row = draftScanRows('Znak teczki; Tytuł teczki; Kat. akt\nA/1; Umowy; B10')[0];
  assert.equal(invalidScanDateRange({ ...row, dateFrom: '2025-01-01', dateTo: '2024-12-31' }), true);
  assert.equal(invalidScanDateRange({ ...row, dateFrom: '2025-01-01', dateTo: '2025-01-01' }), false);
  assert.equal(invalidScanDateRange({ ...row, dateFrom: '2025-01-01' }), false);
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
  assert.equal(rows[0].uncertainDateRange, undefined);
  assert.equal(rows[1].folderTitle, 'Brak dat');
  assert.equal(rows[1].dateRangeUnknown, false);
  assert.equal(rows[2].dateRangeUnknown, false);
});

test('passes reviewed missing-date markers to the transfer list import', async () => {
  let importedItems;
  const createFromReviewedScan = mock.method(transferListService, 'createFromReviewedScan', async (_title, _tenantId, _userId, items) => {
    importedItems = items;
    return { listId: 'list-1', listNumber: 'SZO-1', title: 'Spis testowy', imported: items.length };
  });
  try {
    const result = await importService.importReviewedScan({
      title: 'Spis testowy',
      confirmed: true,
      items: [
        { folderSignature: 'A/1', folderTitle: 'Brak dat w źródle', categoryCode: 'B10', dateRangeUnknown: true, folderCount: 46 },
        { folderSignature: 'A/2', folderTitle: 'Daty niewypełnione', categoryCode: 'B10' },
        { folderSignature: 'A/3', folderTitle: 'Rok przestępny', categoryCode: 'B10', dateFrom: '2024-02-29', dateTo: '2024-02-29' },
      ],
    }, 'tenant', 'user');
    assert.equal(result.imported, 3);
    assert.equal(importedItems[0].dateRangeUnknown, true);
    assert.equal(importedItems[0].folderCount, 46);
    assert.equal(importedItems[1].dateRangeUnknown, undefined);
    assert.equal(importedItems[2].dateFrom, '2024-02-29');
  } finally {
    createFromReviewedScan.mock.restore();
  }
});

test('rolls back a failed reviewed scan and saves a complete retry with one source box', async () => {
  const staged = { lists: [], boxes: [], folders: [], items: [] };
  const persisted = { lists: [], boxes: [], folders: [], items: [] };
  let failSecond = true;
  const tx = {
    transferList: {
      findFirst: async () => null,
      create: async ({ data }) => {
        const list = { id: 'list-1', ...data };
        staged.lists.push(list);
        return list;
      },
    },
    tenant: { findUnique: async () => ({ shortCode: 'TEST' }) },
    box: {
      findFirst: async () => staged.boxes.at(-1) || null,
      create: async ({ data }) => {
        const box = { id: `box-${staged.boxes.length + 1}`, ...data };
        staged.boxes.push(box);
        return box;
      },
    },
    folder: {
      create: async ({ data }) => {
        const folder = { id: `folder-${staged.folders.length + 1}`, ...data };
        staged.folders.push(folder);
        return folder;
      },
    },
    transferListItem: {
      findFirst: async () => staged.items.at(-1) || null,
      create: async ({ data }) => {
        if (failSecond && data.ordinalNumber === 2) {
          throw Object.assign(new Error('Błąd drugiej pozycji'), { code: 'P2002', meta: { target: ['folderId'] } });
        }
        const item = { id: `item-${staged.items.length + 1}`, ...data };
        staged.items.push(item);
        return item;
      },
    },
  };
  const transaction = mock.method(prisma, '$transaction', async (callback) => {
    const result = await callback(tx);
    for (const key of Object.keys(persisted)) persisted[key].push(...staged[key]);
    return result;
  });
  try {
    const input = {
      title: 'Spis testowy', confirmed: true,
      items: [
        { folderSignature: 'A/1', folderTitle: 'Umowy', categoryCode: 'B10', boxNumber: '7' },
        { folderSignature: 'A/2', folderTitle: 'Akta', categoryCode: 'B10', boxNumber: '7' },
      ],
    };
    await assert.rejects(importService.importReviewedScan(input, 'tenant', 'user'), (error) => {
      assert.match(error.message, /Pozycja 2: Błąd drugiej pozycji/);
      assert.equal(error.code, 'P2002');
      assert.deepEqual(error.meta, { target: ['folderId'] });
      assert.equal(error.importRow, 2);
      let response;
      const res = {
        status(statusCode) { response = { statusCode }; return this; },
        json(body) { response.body = body; return this; },
      };
      errorHandler(error, { method: 'POST', path: '/api/import/transfer-lists/scan' }, res, () => {});
      assert.equal(response.statusCode, 409);
      assert.match(response.body.error, /^Pozycja 2: Konflikt unikalności danych w bazie/);
      return true;
    });
    assert.deepEqual(Object.fromEntries(Object.entries(staged).map(([key, value]) => [key, value.length])), {
      lists: 1, boxes: 1, folders: 2, items: 1,
    });
    assert.deepEqual(persisted, { lists: [], boxes: [], folders: [], items: [] });
    for (const values of Object.values(staged)) values.length = 0;
    failSecond = false;
    const result = await importService.importReviewedScan(input, 'tenant', 'user');
    assert.equal(result.imported, 2);
    assert.deepEqual(result.errors, []);
    assert.equal(staged.boxes.length, 1);
    assert.equal(staged.items.length, 2);
    assert.equal(staged.items[0].boxId, staged.items[1].boxId);
    assert.deepEqual(Object.fromEntries(Object.entries(persisted).map(([key, value]) => [key, value.length])), {
      lists: 1, boxes: 1, folders: 2, items: 2,
    });
    assert.equal(transaction.mock.callCount(), 2);
  } finally {
    transaction.mock.restore();
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
  const firstPage = `${header}\n1; A/1; Dokumentacja zarządu; 2020-2024; B10; 46; Magazyn; ; 7\n; ; i uchwały wspólnoty; ; ; ; ; ; `;
  const secondPage = '2; A/2; Akta finansowe; brak dat; B50; 3; Magazyn; ; 8';
  const result = draftScanPages([firstPage, secondPage], []);
  assert.equal(result.missingPage, null);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].folderTitle, 'Dokumentacja zarządu i uchwały wspólnoty');
  assert.equal(result.rows[0].sourceOrdinal, 1);
  assert.equal(result.rows[0].dateFrom, '2020-01-01');
  assert.equal(result.rows[0].dateTo, '2024-12-31');
  assert.equal(result.rows[0].categoryCode, 'B10');
  assert.equal(result.rows[0].folderCount, '46');
  assert.equal(result.rows[0].boxNumber, '7');
  assert.equal(result.rows[1].sourcePage, 2);
  assert.equal(result.rows[1].sourceOrdinal, 2);
  assert.equal(result.rows[1].dateRangeUnknown, true);
  assert.equal(result.rows[1].folderCount, '3');
  assert.equal(result.rows[1].boxNumber, '8');
});

test('lists every distinct source box number for explicit review before scan import', () => {
  const rows = draftScanRows('Znak teczki; Tytuł teczki; Kat. akt; Numer kartonu\nA/1; Umowy; B10; 7\nA/2; Akta; B10; 7\nA/3; Korespondencja; B10; 8\nA/4; Puste; B10; ');
  assert.deepEqual(scanBoxNumbers(rows), ['7', '8']);
  assert.equal(validScanBoxNumber(''), true);
  assert.equal(validScanBoxNumber('7'), true);
  assert.equal(validScanBoxNumber('x'.repeat(100)), true);
  assert.equal(validScanBoxNumber('x'.repeat(101)), false);
});

test('flags missing and repeated source ordinals across pages, independently of box numbers', () => {
  const header = 'Lp.; Znak teczki; Tytuł teczki; Kat. akt; Numer kartonu';
  const result = draftScanPages([
    `${header}\n1; A/1; Umowy; B10; 9\n2; A/2; Akta; B10; 9`,
    `${header}\n4; A/3; Pisma; B10; 1\n4; A/4; Inne; B10; 1`,
  ], []);
  assert.deepEqual(result.rows.map((row) => row.sourceOrdinal), [1, 2, 4, 4]);
  assert.deepEqual(scanOrdinalIssues(result.rows), { gaps: [{ from: 3, to: 3 }], duplicates: [4], unreadableRows: [], outOfOrderRows: [] });
  assert.deepEqual(scanBoxNumbers(result.rows), ['9', '1']);
});

test('does not infer source ordinals from box numbers or an unnumbered table', () => {
  const rows = draftScanRows('Znak teczki; Tytuł teczki; Kat. akt; Numer kartonu\nA/1; Umowy; B10; 1\nA/2; Akta; B10; 3');
  assert.deepEqual(rows.map((row) => row.sourceOrdinal), [undefined, undefined]);
  assert.deepEqual(scanOrdinalIssues(rows), { gaps: [], duplicates: [], unreadableRows: [], outOfOrderRows: [] });
});

test('finds gaps in visual OCR rows without treating wrapped titles as items', () => {
  const rows = draftScanRows('Lp. Znak teczki Tytuł teczki Kat. akt Liczba teczek\n1 A/1 Umowy B10 1\n2 A/2 Dokumentacja B10 1\ni aneksy\n4 A/4 Akta B50 1');
  assert.deepEqual(rows.map((row) => row.sourceOrdinal), [1, 2, 4]);
  assert.equal(rows[1].folderTitle, 'Dokumentacja i aneksy');
  assert.deepEqual(scanOrdinalIssues(rows), { gaps: [{ from: 3, to: 3 }], duplicates: [], unreadableRows: [], outOfOrderRows: [] });
});

test('flags an unreadable Lp cell but not a continued title in a mapped table', () => {
  const header = 'Lp.; Znak teczki; Tytuł teczki; Kat. akt';
  const rows = draftScanRows(`${header}\n1; A/1; Umowy; B10\n; ; i aneksy; \n?; A/2; Akta; B10\n3; A/3; Pisma; B10`);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].folderTitle, 'Umowy i aneksy');
  assert.equal(rows[1].sourceOrdinalExpected, true);
  assert.equal(rows[1].sourceOrdinal, undefined);
  assert.deepEqual(scanOrdinalIssues(rows), { gaps: [{ from: 2, to: 2 }], duplicates: [], unreadableRows: [2], outOfOrderRows: [] });
});

test('keeps a visual OCR row whose Lp was lost instead of joining it to the previous title', () => {
  const rows = draftScanRows('Lp. Znak teczki Tytuł teczki Kat. akt Liczba teczek\n1 NOVUM/1 Umowy B10 1\nNOVUM/2 Akta B10 1\n3 NOVUM/3 Pisma B10 1');
  assert.deepEqual(rows.map((row) => row.folderSignature), ['NOVUM/1', 'NOVUM/2', 'NOVUM/3']);
  assert.deepEqual(rows.map((row) => row.sourceOrdinal), [1, undefined, 3]);
  assert.deepEqual(scanOrdinalIssues(rows), { gaps: [{ from: 2, to: 2 }], duplicates: [], unreadableRows: [2], outOfOrderRows: [] });
});

test('recognizes a misread visual Lp on the next page without treating it as a title', () => {
  const result = draftScanPages([
    'Lp. Znak teczki Tytuł teczki Kat. akt Liczba teczek\n1 NOVUM/1 Umowy B10 1',
    'I NOVUM/2 Akta B10 1\n3 NOVUM/3 Pisma B10 1',
  ], []);
  assert.equal(result.missingPage, null);
  assert.deepEqual(result.rows.map((row) => row.folderSignature), ['NOVUM/1', 'NOVUM/2', 'NOVUM/3']);
  assert.equal(result.rows[1].sourcePage, 2);
  assert.deepEqual(scanOrdinalIssues(result.rows), { gaps: [{ from: 2, to: 2 }], duplicates: [], unreadableRows: [2], outOfOrderRows: [] });
});

test('flags missing initial source numbers without guessing a missing final number', () => {
  const rows = draftScanRows('Lp.; Znak teczki; Tytuł teczki; Kat. akt\n2; A/2; Akta; B10\n3; A/3; Pisma; B10');
  assert.deepEqual(scanOrdinalIssues(rows), { gaps: [{ from: 1, to: 1 }], duplicates: [], unreadableRows: [], outOfOrderRows: [] });
});

test('compares a declared source item count even without source Lp numbers', () => {
  const rows = draftScanRows('Znak teczki; Tytuł teczki; Kat. akt\nA/1; Umowy; B10\nA/2; Akta; B10');
  assert.equal(scanExpectedRowCountStatus('', rows.length), 'empty');
  assert.equal(scanExpectedRowCountStatus('2', rows.length), 'match');
  assert.equal(scanExpectedRowCountStatus('3', rows.length), 'mismatch');
  assert.deepEqual(scanOrdinalIssues(rows), { gaps: [], duplicates: [], unreadableRows: [], outOfOrderRows: [] });
  assert.equal(scanExpectedRowCountStatus('1', rows.length), 'mismatch');
});

test('flags repeated folder content across pages without confusing distinct volumes', () => {
  const result = draftScanPages([
    'Znak teczki; Tytuł teczki; Daty skrajne; Kat. akt\nA/1; Akta zarządu; 2020; B10\nA/1; Akta zarządu; 2021; B10',
    'A/1; Akta zarządu; 2020; B10\nA/1; Inne akta; 2020; B10',
  ], []);
  assert.deepEqual(scanContentDuplicateGroups(result.rows), [
    { signature: 'A/1', title: 'Akta zarządu', rows: [1, 3] },
  ]);
  assert.deepEqual(result.rows.map((row) => row.sourcePage), [1, 1, 2, 2]);
});

test('normalizes spacing and case in duplicate checks, but ignores incomplete rows', () => {
  const rows = draftScanRows('Znak teczki; Tytuł teczki; Kat. akt\nA/1; Umowy Spółki; B10\nA/2; Inne; B10');
  const repeated = { ...rows[0], folderSignature: ' a/1 ', folderTitle: '  UMOWY   SPÓŁKI  ', boxNumber: '99' };
  assert.deepEqual(scanContentDuplicateGroups([rows[0], rows[1], repeated]), [
    { signature: 'A/1', title: 'Umowy Spółki', rows: [1, 3] },
  ]);
  assert.deepEqual(scanContentDuplicateGroups([rows[0], { ...repeated, folderTitle: '' }]), []);
  assert.deepEqual(scanContentDuplicateGroups([rows[0], { ...repeated, dateRangeUnknown: true }]), []);
});

test('rejects invalid declared source item counts', () => {
  for (const value of ['0', '501', '1.5', 'abc', '02', '-1']) {
    assert.equal(scanExpectedRowCountStatus(value, 2), 'invalid');
  }
  assert.equal(scanExpectedRowCountStatus(' 2 ', 2), 'match');
});

test('flags source numbers that move backwards across pages', () => {
  const result = draftScanPages([
    'Lp.; Znak teczki; Tytuł teczki; Kat. akt; Numer kartonu\n1; A/1; Umowy; B10; 9\n3; A/3; Akta; B10; 9',
    '2; A/2; Pisma; B10; 1',
  ], []);
  assert.deepEqual(result.rows.map((row) => row.sourceOrdinal), [1, 3, 2]);
  assert.deepEqual(scanOrdinalIssues(result.rows), { gaps: [], duplicates: [], unreadableRows: [], outOfOrderRows: [3] });
  assert.deepEqual(scanBoxNumbers(result.rows), ['9', '1']);
});

test('points ordinal warnings to the relevant draft rows and source pages', () => {
  const result = draftScanPages([
    'Lp.; Znak teczki; Tytuł teczki; Kat. akt\n2; A/2; Umowy; B10\n5; A/5; Akta; B10',
    '5; A/5B; Pisma; B10\n?; A/6; Inne; B10\n4; A/4; Rejestry; B10',
  ], []);
  assert.deepEqual(scanOrdinalIssueLocations(result.rows), [
    { kind: 'gap', value: '1', row: 1, page: 1 },
    { kind: 'gap', value: '3', row: 2, page: 1 },
    { kind: 'duplicate', value: '5', row: 2, page: 1 },
    { kind: 'duplicate', value: '5', row: 3, page: 2 },
    { kind: 'unreadable', value: '4', row: 4, page: 2 },
    { kind: 'outOfOrder', value: '5', row: 5, page: 2 },
  ]);
});

test('corrects source ordinals in the draft without changing the extracted text or row order', () => {
  const rows = draftScanRows('Lp.; Znak teczki; Tytuł teczki; Kat. akt\n1; A/1; Umowy; B10\n3; A/2; Akta; B10\n2; A/3; Pisma; B10');
  const corrected = rows.map((row, index) => index === 1 ? correctScanSourceOrdinal(row, '2') : index === 2 ? correctScanSourceOrdinal(row, '3') : row);
  assert.deepEqual(rows.map((row) => row.sourceOrdinal), [1, 3, 2]);
  assert.deepEqual(corrected.map((row) => row.sourceOrdinal), [1, 2, 3]);
  assert.deepEqual(corrected.map((row) => row.folderSignature), ['A/1', 'A/2', 'A/3']);
  assert.deepEqual(scanOrdinalIssues(corrected), { gaps: [], duplicates: [], unreadableRows: [], outOfOrderRows: [] });
});

test('keeps invalid source-number edits visible and treats an empty edit as unreadable', () => {
  const row = draftScanRows('Lp.; Znak teczki; Tytuł teczki; Kat. akt\n1; A/1; Umowy; B10')[0];
  for (const value of ['0', '10000', '1.5', 'abc', '01']) {
    assert.equal(validScanSourceOrdinal(value), false);
    const edited = correctScanSourceOrdinal(row, value);
    assert.equal(edited.sourceOrdinalInput, value);
    assert.equal(edited.sourceOrdinal, undefined);
    assert.deepEqual(scanOrdinalIssues([edited]).unreadableRows, [1]);
  }
  assert.equal(validScanSourceOrdinal(' 9999 '), true);
  const empty = correctScanSourceOrdinal(row, '');
  assert.equal(empty.sourceOrdinal, undefined);
  assert.deepEqual(scanOrdinalIssues([empty]).unreadableRows, [1]);
  assert.equal(row.sourceOrdinal, 1);
});

test('keeps an empty or invalid count visible for correction instead of silently using one', () => {
  const rows = draftScanRows('Znak teczki; Tytuł teczki; Kat. akt; Liczba teczek\nA/1; Umowy; B10; \nA/2; Akta; B50; 0');
  assert.equal(rows[0].folderCount, '');
  assert.equal(rows[1].folderCount, '0');
  assert.equal(validFolderCount(rows[0].folderCount), false);
  assert.equal(validFolderCount(rows[1].folderCount), false);
  assert.equal(validFolderCount('46'), true);
  assert.equal(validFolderCount('1.5'), false);
});

test('leaves ambiguous OCR categories and invalid dates for manual correction', () => {
  const header = 'Lp.; Znak teczki; Tytuł teczki lub tomu; Daty skrajne; Kat. akt';
  const rows = draftScanRows(`${header}\n1; A/1; Akta zarządu; 0020-2024; B1O\n2; A/2; Umowy; 2020-2024; B10`);
  assert.equal(rows[0].folderSignature, 'A/1');
  assert.equal(rows[0].categoryCode, '');
  assert.equal(rows[0].uncertainCategory, 'B1O');
  assert.equal(rows[0].dateFrom, '');
  assert.equal(rows[0].dateTo, '');
  assert.equal(rows[0].uncertainDateRange, '0020-2024');
  assert.equal(needsScanDateReview(rows[0]), true);
  assert.equal(rows[1].categoryCode, 'B10');
  assert.equal(rows[1].dateFrom, '2020-01-01');
  assert.equal(rows[1].uncertainDateRange, undefined);
  assert.equal(needsScanDateReview(rows[1]), false);
});

test('keeps uncertain single dates and counts beside mapped scan fields', () => {
  const rows = draftScanRows('Znak teczki; Tytuł teczki; Data od; Data do; Kat. akt; Liczba teczek\nA/1; Umowy; 20O0; 2024; B10; ?\nA/2; Akta; brak dat; ; B10; 2');
  assert.equal(rows[0].folderTitle, 'Umowy');
  assert.equal(rows[0].dateFrom, '');
  assert.equal(rows[0].dateTo, '2024-12-31');
  assert.equal(rows[0].uncertainDateFrom, '20O0');
  assert.equal(rows[0].uncertainFolderCount, '?');
  assert.equal(needsScanDateReview(rows[0]), true);
  assert.equal(needsScanDateReview({ ...rows[0], dateFrom: '2020-01-01' }), false);
  assert.equal(rows[1].dateRangeUnknown, true);
  assert.equal(rows[1].uncertainDateFrom, undefined);
  assert.equal(rows[1].uncertainFolderCount, undefined);
  assert.equal(needsScanDateReview({ ...rows[0], dateRangeUnknown: true }), false);
});

test('keeps an OCR-misread year separate from a visual row title', () => {
  const rows = draftScanRows('Lp. Znak teczki Tytuł teczki lub tomu Daty skrajne od —do Kat. akt Liczba teczek\n1 NOVUM/1 Umowy 2O07-2017 B5 l');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].folderTitle, 'Umowy');
  assert.equal(rows[0].dateFrom, '');
  assert.equal(rows[0].dateTo, '');
  assert.equal(rows[0].uncertainDateRange, '2O07-2017');
  assert.equal(needsScanDateReview(rows[0]), true);
  assert.equal(needsScanDateReview({ ...rows[0], dateFrom: '2007-01-01', dateTo: '2017-12-31' }), false);
  assert.equal(rows[0].folderCount, 'l');
  assert.equal(rows[0].uncertainFolderCount, 'l');
});

test('joins an indented continuation but keeps a new incomplete entry separate', () => {
  const rows = draftScanRows('A/1; Umowy; B10\n    i aneksy\nA/2; Wiersz bez kategorii');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].folderTitle, 'Umowy i aneksy');
  assert.equal(rows[1].categoryCode, '');
});

test('reads a Word-generated PDF table with wrapped titles and ignores its footer', () => {
  const firstPage = [
    'Spis zdawczo-odbiorczy akt nr 1/08/2022',
    'Lp. Znak teczki Tytuł teczki lub tomu Daty skrajne od –do Kat. akt Liczba',
    'teczek Miejsce przechowywania Data zniszczenia',
    '1 2 3 4 5 6 7 8',
    '1 TEST/1 Umowy 2007-2017 B5 1',
    '2 TEST/2 Dokumentacja kredytowa 2012-2016 B10 3',
    'i aneksy',
    '3 TEST/3 Akta osobowe 2018 B50 46',
    '4 TEST/4 Sprawozdanie',
    'finansowe i protokół',
    '2019 B10 3',
    'Przekazujący akta Kierownik Komórki Organizacyjnej Przyjmujący akta',
    'Imię i nazwisko',
  ].join('\n');
  const secondPage = 'Dane kontaktowe\n(podpis)\nData przekazania akt:';
  const withoutReview = draftScanPages([firstPage, secondPage], []);
  assert.equal(withoutReview.missingPage, 2);
  const reviewed = draftScanPages([firstPage, secondPage], [2]);
  assert.equal(reviewed.rows.length, 4);
  assert.deepEqual(reviewed.rows.map((row) => row.folderSignature), ['TEST/1', 'TEST/2', 'TEST/3', 'TEST/4']);
  assert.equal(reviewed.rows[0].dateFrom, '2007-01-01');
  assert.equal(reviewed.rows[0].dateTo, '2017-12-31');
  assert.equal(reviewed.rows[0].folderCount, '1');
  assert.equal(reviewed.rows[1].folderTitle, 'Dokumentacja kredytowa i aneksy');
  assert.equal(reviewed.rows[1].categoryCode, 'B10');
  assert.equal(reviewed.rows[1].folderCount, '3');
  assert.equal(reviewed.rows[2].dateTo, '2018-12-31');
  assert.equal(reviewed.rows[2].folderCount, '46');
  assert.equal(reviewed.rows[2].boxNumber, '');
  assert.equal(reviewed.rows[3].folderTitle, 'Sprawozdanie finansowe i protokół');
  assert.equal(reviewed.rows[3].dateFrom, '2019-01-01');
  assert.equal(reviewed.rows[3].folderCount, '3');
});

test('separates dates and titles when OCR misreads a category or count', () => {
  const text = [
    'Spis zdawczo-odbiorczy akt nr 1/08/2022',
    'Lp. Znak teczki Tytuł teczki lub tomu Daty skrajne od —do Kat. akt Liczba teczek',
    '1 NOVUM/1 URZAD SKARBOWY 2007-2017 BS l',
    '2 NOVUM/2 KSIĄŻKA KONTROLI | 2008-2016 BS 1',
    '11 NOVUM/11 AKTA OSOBOWE 2008-2018 B50 46',
    '12 NOVUM/12 | SAD- UMOWA 2012-2016 B10 3',
    'KREDYT',
    '14 NOVUM/14 | SPRAWY SĄDOWE 2016 B10 l',
    'Przekazujacy akta Kierownik Komórki Organizacyjnej Przyjmujący akta',
  ].join('\n');
  const rows = draftScanRows(text);
  assert.equal(rows.length, 5);
  assert.equal(rows[0].folderTitle, 'URZAD SKARBOWY');
  assert.equal(rows[0].dateFrom, '2007-01-01');
  assert.equal(rows[0].dateTo, '2017-12-31');
  assert.equal(rows[0].categoryCode, '');
  assert.equal(rows[0].uncertainCategory, 'BS');
  assert.equal(rows[0].folderCount, 'l');
  assert.equal(rows[0].uncertainFolderCount, 'l');
  assert.equal(validFolderCount(rows[0].folderCount), false);
  assert.equal(rows[1].folderTitle, 'KSIĄŻKA KONTROLI');
  assert.equal(rows[1].categoryCode, '');
  assert.equal(rows[1].uncertainCategory, 'BS');
  assert.equal(rows[2].categoryCode, 'B50');
  assert.equal(rows[2].uncertainCategory, undefined);
  assert.equal(rows[2].folderCount, '46');
  assert.equal(rows[2].uncertainFolderCount, undefined);
  assert.equal(rows[3].folderTitle, 'SAD- UMOWA KREDYT');
  assert.equal(rows[4].folderTitle, 'SPRAWY SĄDOWE');
  assert.equal(rows[4].categoryCode, 'B10');
  assert.equal(rows[4].folderCount, 'l');
});
