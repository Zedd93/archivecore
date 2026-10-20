const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const {
  inspectTransferListImport,
  parseTransferListImport,
  parseTransferListImportOptions,
} = require('../dist/modules/transfer-lists/transfer-list-import.parser');
const { importService } = require('../dist/modules/import-export/import.service');
const { TransferListService } = require('../dist/modules/transfer-lists/transfer-list.service');

function workbook(sheets) {
  const book = XLSX.utils.book_new();
  for (const [name, rows] of sheets) {
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return XLSX.write(book, { bookType: 'xlsx', type: 'buffer' });
}

test('keeps automatic recognition for existing transfer lists', async () => {
  const buffer = workbook([['Spis', [
    ['Znak teczki', 'Tytuł teczki lub tomu', 'Kat. akt', 'Numer kartonu'],
    ['A/1', 'Umowy Łódź', 'B10', '1'],
  ]]]);
  const parsed = parseTransferListImport(buffer);
  assert.equal(parsed.headerRow, 1);
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].folderTitle, 'Umowy Łódź');
  const preview = await importService.previewTransferLists(buffer, 'spis.xlsx');
  assert.equal(preview.rows.length, 1);
  assert.deepEqual(preview.errors, []);
});

test('preserves Excel row numbers when a sheet starts with empty rows', async () => {
  const buffer = workbook([['Spis', [
    [],
    [],
    ['Znak teczki', 'Tytuł teczki', 'Kat. akt'],
    ['A/1', 'Umowy', 'B10'],
  ]]]);
  const parsed = parseTransferListImport(buffer);
  assert.equal(parsed.headerRow, 3);
  assert.deepEqual(parsed.rowNumbers, [4]);
  const preview = await importService.previewTransferLists(buffer, 'spis.xlsx');
  assert.equal(preview.rows[0]._rowIndex, 4);
});

test('maps a selected sheet and unconventional headers without changing the source file', async () => {
  const buffer = workbook([
    ['Opis', [['Instrukcja importu']]],
    ['Dane klienta', [
      ['Spis dokumentacji klienta'],
      ['Sygn. jednostki', 'Nazwa tomu', 'Klasa', 'Lata', 'Pudło'],
      ['X-01', 'Akta osobowe Żanety', 'B50', '2020-2024', '7'],
      ['X-02', 'Bez kategorii', '', '2021', '7'],
    ]],
  ]);
  const inspected = inspectTransferListImport(buffer);
  assert.equal(inspected.length, 2);
  assert.equal(inspected[1].detectedHeaderRow, null);
  assert.equal(inspected[1].rows[1].cells[1], 'Nazwa tomu');

  const options = parseTransferListImportOptions(JSON.stringify({
    sheetName: 'Dane klienta',
    headerRow: 2,
    columns: { 0: 'folderSignature', 1: 'folderTitle', 2: 'categoryCode', 3: '_dateRange', 4: 'boxNumber' },
  }));
  const parsed = parseTransferListImport(buffer, options);
  assert.equal(parsed.items.length, 1);
  assert.deepEqual(parsed.errors, [{ row: 4, message: 'Brak znaku, tytułu lub kategorii teczki' }]);
  assert.equal(parsed.items[0].folderTitle, 'Akta osobowe Żanety');
  assert.equal(parsed.items[0].dateFrom, '2020-01-01');
  assert.equal(parsed.items[0].dateTo, '2024-12-31');
  assert.equal(parsed.items[0].boxNumber, '7');

  const preview = await importService.previewTransferLists(buffer, 'dane.xlsx', options);
  assert.equal(preview.rows[0]._rowIndex, 3);
  assert.deepEqual(preview.errors, parsed.errors);
});

test('distinguishes explicit missing dates from an empty date range', async () => {
  const buffer = workbook([['Spis', [
    ['Znak teczki', 'Tytuł teczki lub tomu', 'Daty skrajne', 'Kat. akt'],
    ['A/1', 'Brak dat w źródle', 'brak dat', 'B50'],
    ['A/2', 'Puste pole', '', 'B50'],
    ['A/3', 'Daty podane', '2020-2024', 'B50'],
  ]]]);
  const parsed = parseTransferListImport(buffer);
  assert.equal(parsed.items.length, 3);
  assert.deepEqual(parsed.items.map((item) => item.dateRangeUnknown), [true, false, false]);
  assert.deepEqual(parsed.items.map((item) => [item.dateFrom, item.dateTo]), [
    [null, null],
    [null, null],
    ['2020-01-01', '2024-12-31'],
  ]);
});

test('persists a source missing-dates marker without inventing folder dates', async () => {
  const service = new TransferListService();
  let folderData;
  let itemData;
  const tx = {
    folder: { create: async ({ data }) => { folderData = data; return { id: 'folder-id' }; } },
    transferListItem: { create: async ({ data }) => { itemData = data; return data; } },
  };
  const list = { id: 'list-id', tenantId: 'tenant-id' };
  const data = { folderSignature: 'A/1', folderTitle: 'Akta', categoryCode: 'B50', dateRangeUnknown: true };
  await service.createItemWithCanonicalFolder(tx, list, data, null, null, 1);
  assert.equal(folderData.dateFrom, null);
  assert.equal(folderData.dateTo, null);
  assert.equal(itemData.dateRangeUnknown, true);
  assert.equal(itemData.folderId, 'folder-id');
  await assert.rejects(
    service.createItemWithCanonicalFolder(tx, list, { ...data, dateFrom: '2020-01-01' }, null, null, 2),
    { statusCode: 400 },
  );
});

test('rejects unsafe, duplicate, or incomplete mappings before import', () => {
  const base = { sheetName: 'Spis', headerRow: 1, columns: { 0: 'folderSignature', 1: 'folderTitle', 2: 'categoryCode' } };
  assert.throws(() => parseTransferListImportOptions('{'), /mapowanie/);
  assert.throws(() => parseTransferListImportOptions({ ...base, columns: { 0: 'folderSignature', 1: 'folderSignature', 2: 'categoryCode' } }), /jednej kolumny/);
  assert.throws(() => parseTransferListImportOptions({ ...base, columns: { 0: 'folderSignature', 1: 'folderTitle' } }), /Wymagane mapowanie/);
  assert.throws(() => parseTransferListImportOptions({ ...base, columns: { ...base.columns, 99: 'notes', 3: 'unknown' } }), /Invalid enum value/);
});
