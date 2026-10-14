const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const { prisma } = require('../dist/config/database.js');
const { importService } = require('../dist/modules/import-export/import.service.js');
const { parseTableImportOptions, parseMappedTableRows } = require('../dist/modules/import-export/table-import.parser.js');

function workbook(sheets) {
  const book = XLSX.utils.book_new();
  for (const [name, rows] of sheets) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
  return XLSX.write(book, { bookType: 'xlsx', type: 'buffer' });
}

test('box preview and import use the same selected sheet, header row, and mapping', async () => {
  const buffer = workbook([
    ['Instrukcja', [['Nie importować']]],
    ['Kartony', [
      ['Dane klienta'],
      ['Nazwa pudła', 'Rodzaj', 'Komentarz'],
      ['Dokumenty Łodzi', 'personnel_files', 'Pierwsza partia'],
      ['', 'personnel_files', 'Bez tytułu'],
    ]],
  ]);
  const inspected = importService.inspectBoxes(buffer);
  assert.equal(inspected[1].detectedHeaderRow, null);
  assert.equal(inspected[1].rows[1].cells[0], 'Nazwa pudła');
  const options = parseTableImportOptions(JSON.stringify({
    sheetName: 'Kartony', headerRow: 2, columns: { 0: 'title', 1: 'docType', 2: 'notes' },
  }), 'boxes');
  const preview = await importService.previewBoxes(buffer, 'kartony.xlsx', options);
  assert.equal(preview.rows.length, 1);
  assert.equal(preview.rows[0].title, 'Dokumenty Łodzi');
  assert.equal(preview.rows[0]._rowIndex, 3);
  assert.deepEqual(preview.errors.map((error) => error.row), [4]);

  const originals = { tenant: prisma.tenant.findUnique, lastBox: prisma.box.findFirst, create: prisma.box.create };
  const created = [];
  prisma.tenant.findUnique = async () => ({ shortCode: 'DOX' });
  prisma.box.findFirst = async () => null;
  prisma.box.create = async ({ data }) => { created.push(data); return data; };
  try {
    const result = await importService.importBoxes(buffer, 'kartony.xlsx', 'tenant-1', 'user-1', options);
    assert.equal(result.totalRows, 2);
    assert.equal(result.imported, 1);
    assert.deepEqual(result.errors.map((error) => error.row), [4]);
    assert.equal(created[0].title, preview.rows[0].title);
    assert.equal(created[0].notes, 'Pierwsza partia');
  } finally {
    prisma.box.create = originals.create;
    prisma.box.findFirst = originals.lastBox;
    prisma.tenant.findUnique = originals.tenant;
  }
});

test('personnel preview and import map nonstandard columns without exposing PESEL in preview', async () => {
  const buffer = workbook([['Kadry', [
    ['Lista osób'],
    ['Pracownik', 'Nazwisko rodowe', 'Identyfikator'],
    ['Anna', 'Nowak', '44051401359'],
    ['Piotr', 'Kowalski', ''],
  ]]]);
  const options = parseTableImportOptions({
    sheetName: 'Kadry', headerRow: 2,
    columns: { 0: 'employeeFirstName', 1: 'employeeLastName', 2: 'employeePesel' },
  }, 'hr');
  const preview = await importService.previewHR(buffer, 'kadry.xlsx', options);
  assert.equal(preview.rows.length, 1);
  assert.equal(preview.rows[0].employeePesel, '440********');
  assert.deepEqual(preview.errors.map((error) => error.row), [4]);

  const originals = { find: prisma.hRFolder.findFirst, create: prisma.hRFolder.create };
  const created = [];
  prisma.hRFolder.findFirst = async () => null;
  prisma.hRFolder.create = async ({ data }) => { created.push(data); return data; };
  try {
    const result = await importService.importHR(buffer, 'kadry.xlsx', 'tenant-1', 'user-1', options);
    assert.equal(result.imported, 1);
    assert.deepEqual(result.errors.map((error) => error.row), [4]);
    assert.equal(created[0].employeeFirstName, 'Anna');
    assert.notEqual(created[0].employeePesel, '44051401359');
  } finally {
    prisma.hRFolder.create = originals.create;
    prisma.hRFolder.findFirst = originals.find;
  }
});

test('automatic headers still work and invalid manual mappings are rejected', async () => {
  const buffer = workbook([['Kartony', [['Tytuł', 'Uwagi'], ['Umowy', 'archiwum']]]]);
  const preview = await importService.previewBoxes(buffer, 'auto.xlsx');
  assert.equal(preview.rows[0].title, 'Umowy');
  assert.equal(preview.rows[0]._rowIndex, 2);

  const base = { sheetName: 'Kartony', headerRow: 1, columns: { 0: 'title' } };
  assert.throws(() => parseTableImportOptions('{', 'boxes'), /mapowanie/);
  assert.throws(() => parseTableImportOptions({ ...base, columns: { 0: 'notes' } }, 'boxes'), /Wymagane mapowanie/);
  assert.throws(() => parseTableImportOptions({ ...base, columns: { 0: 'title', 1: 'title' } }, 'boxes'), /jednej kolumny/);
  assert.throws(() => parseTableImportOptions({ ...base, columns: { 0: 'title', 1: 'employeePesel' } }, 'boxes'), /Nieznane pole/);
  assert.throws(() => parseTableImportOptions({ ...base, columns: { 0: 'title', 99: 'notes' } }, 'boxes'), /indeksy/);
  assert.throws(() => parseMappedTableRows(buffer, { ...base, sheetName: 'Brak' }), /Nie znaleziono/);
});
