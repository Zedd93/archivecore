const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs/promises');
const { PDFDocument } = require('pdf-lib');

async function blankPdf(pageCount) {
  const document = await PDFDocument.create();
  for (let index = 0; index < pageCount; index++) document.addPage();
  return Buffer.from(await document.save());
}

test('reads a selected PDF page without silently skipping other pages', async () => {
  const originalExecFile = childProcess.execFile;
  const calls = [];
  let emptyPage = null;
  let ocrOverride = null;
  childProcess.execFile = (binary, args, _options, callback) => {
    calls.push({ binary, args });
    if (binary === 'pdftoppm') {
      fs.writeFile(`${args.at(-1)}.png`, Buffer.from('image'))
        .then(() => callback(null, { stdout: '' }), callback);
      return;
    }
    if (binary === 'tesseract') {
      const page = Number(args[0].match(/page-(\d+)\.png$/)?.[1]);
      return callback(null, { stdout: page === emptyPage ? '' : ocrOverride ?? `OCR page ${page}` });
    }
    callback(new Error(`Unexpected binary: ${binary}`));
  };

  try {
    const { recognizeScan } = require('../dist/modules/import-export/scan-ocr.service');
    const pdf = await blankPdf(5);
    const selected = await recognizeScan(pdf, 4);
    assert.deepEqual(selected, { text: 'OCR page 4', pages: 5, pageDiagnostics: [
      { page: 4, source: 'ocr', reviewFlag: 'short', containsPesel: false },
    ] });
    await assert.rejects(recognizeScan(pdf), { statusCode: 400 });
    assert.deepEqual(calls.filter((call) => call.binary === 'pdftoppm').map((call) => call.args.slice(0, 4)), [
      ['-f', '4', '-l', '4'],
    ]);
    assert.equal(calls.filter((call) => call.binary === 'tesseract').length, 1);
    assert.ok(calls.find((call) => call.binary === 'pdftoppm').args.includes('3500'));

    emptyPage = 2;
    assert.deepEqual(await recognizeScan(pdf, 2), { text: '', pages: 5, pageDiagnostics: [
      { page: 2, source: 'ocr', reviewFlag: 'empty', containsPesel: false },
    ] });
    emptyPage = null;

    ocrOverride = 'Nieczytelny znak \uFFFD w rozpoznanym tekscie';
    assert.deepEqual((await recognizeScan(pdf, 1)).pageDiagnostics, [
      { page: 1, source: 'ocr', reviewFlag: 'replacement', containsPesel: false },
    ]);
    ocrOverride = 'Poprawnie odczytany tekst ze skanu spisu zdawczo odbiorczego, z wystarczajaca liczba znakow do podgladu pozycji.';
    assert.deepEqual((await recognizeScan(pdf, 1)).pageDiagnostics, [
      { page: 1, source: 'ocr', reviewFlag: null, containsPesel: false },
    ]);
    ocrOverride = 'Przykladowy numer 44051401359 w zeskanowanym spisie';
    assert.deepEqual((await recognizeScan(pdf, 1)).pageDiagnostics, [
      { page: 1, source: 'ocr', reviewFlag: 'short', containsPesel: true },
    ]);
    ocrOverride = null;

    await assert.rejects(recognizeScan(pdf, 6), { statusCode: 400 });
    await assert.rejects(recognizeScan(pdf, Number.NaN), { statusCode: 400 });
    await assert.rejects(recognizeScan(await blankPdf(13), 1), { statusCode: 400 });

    const legacy = await recognizeScan(await blankPdf(3));
    assert.deepEqual(legacy, { text: 'OCR page 1\n\nOCR page 2\n\nOCR page 3', pages: 3, pageDiagnostics: [
      { page: 1, source: 'ocr', reviewFlag: 'short', containsPesel: false },
      { page: 2, source: 'ocr', reviewFlag: 'short', containsPesel: false },
      { page: 3, source: 'ocr', reviewFlag: 'short', containsPesel: false },
    ] });

    emptyPage = 1;
    await assert.rejects(recognizeScan(await blankPdf(1)), { statusCode: 422 });
  } finally {
    childProcess.execFile = originalExecFile;
  }
});

test('PESEL review flag requires a checksum-valid standalone number', () => {
  const { containsPesel } = require('../dist/modules/import-export/scan-ocr.service');
  assert.equal(containsPesel('PESEL: 44051401359'), true);
  assert.equal(containsPesel('PESEL: 44051401358'), false);
  assert.equal(containsPesel('Nr 1440514013592'), false);
});
