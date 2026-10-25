const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const { PNG } = require('pngjs');

function whitePng() {
  const png = new PNG({ width: 120, height: 60 });
  png.data.fill(255);
  return PNG.sync.write(png);
}

function syntheticPesel() {
  const prefix = '0021011234';
  const weights = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
  const sum = [...prefix].reduce((total, digit, index) => total + Number(digit) * weights[index], 0);
  return `${prefix}${(10 - sum % 10) % 10}`;
}

function ocrRow(text) {
  return `5\t1\t1\t1\t1\t1\t10\t10\t70\t12\t95\t${text}`;
}

test('refuses to issue a copy when OCR did not detect a number', async () => {
  const scanOcr = require('../dist/modules/import-export/scan-ocr.service');
  const originalExecute = scanOcr.execute;
  const tsv = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n';
  scanOcr.execute = async (binary, args) => {
    if (binary === 'pdftoppm') {
      await fs.writeFile(`${args.at(-1)}.png`, whitePng());
      return '';
    }
    if (binary === 'tesseract') return tsv;
    throw new Error(`Unexpected binary: ${binary}`);
  };
  try {
    const { createPeselRedactedCopy } = require('../dist/modules/attachments/pdf-redaction.service');
    const original = await PDFDocument.create();
    const page = original.addPage([612, 792]);
    page.drawText('Example', { font: await original.embedFont(StandardFonts.Helvetica) });
    const source = Buffer.from(await original.save());
    const unchangedSource = Buffer.from(source);
    await assert.rejects(createPeselRedactedCopy(source), { statusCode: 422 });
    assert.deepEqual(source, unchangedSource);
  } finally {
    scanOcr.execute = originalExecute;
  }
});

test('redaction paints selected pixels black without changing other pixels', () => {
  const { blackOutPng, peselBoxesFromTsv } = require('../dist/modules/attachments/pdf-redaction.service');
  const pixels = PNG.sync.read(blackOutPng(whitePng(), [{ x: 10, y: 10, width: 70, height: 12 }]));
  assert.deepEqual([...pixels.data.subarray((15 * pixels.width + 15) * 4, (15 * pixels.width + 15) * 4 + 4)], [0, 0, 0, 255]);
  assert.deepEqual([...pixels.data.subarray(0, 4)], [255, 255, 255, 255]);
  assert.deepEqual(peselBoxesFromTsv('level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n5\t1\t1\t1\t1\t1\t0\t0\t40\t10\t95\texample'), []);
});

test('creates a flattened copy after detecting a synthetic PESEL', async () => {
  const scanOcr = require('../dist/modules/import-export/scan-ocr.service');
  const originalExecute = scanOcr.execute;
  const number = syntheticPesel();
  const tsv = `level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n${ocrRow(number)}\n`;
  scanOcr.execute = async (binary, args) => {
    if (binary === 'pdftoppm') {
      await fs.writeFile(`${args.at(-1)}.png`, whitePng());
      return '';
    }
    if (binary === 'tesseract') return tsv;
    throw new Error(`Unexpected binary: ${binary}`);
  };
  try {
    const { createPeselRedactedCopy, peselBoxesFromTsv, blackOutPng } = require('../dist/modules/attachments/pdf-redaction.service');
    assert.deepEqual(peselBoxesFromTsv(tsv), [{ x: 10, y: 10, width: 70, height: 12 }]);
    const wrongCheckDigit = String((Number(number.at(-1)) + 1) % 10);
    assert.deepEqual(peselBoxesFromTsv(tsv.replace(number, `${number.slice(0, -1)}${wrongCheckDigit}`)), []);
    const pixels = PNG.sync.read(blackOutPng(whitePng(), peselBoxesFromTsv(tsv)));
    assert.deepEqual([...pixels.data.subarray((15 * pixels.width + 15) * 4, (15 * pixels.width + 15) * 4 + 4)], [0, 0, 0, 255]);

    const original = await PDFDocument.create();
    original.addPage([612, 792]);
    const source = Buffer.from(await original.save());
    const unchangedSource = Buffer.from(source);
    const result = await createPeselRedactedCopy(source);
    assert.equal(result.redactedCount, 1);
    assert.notDeepEqual(result.buffer, source);
    assert.deepEqual(source, unchangedSource);
    const copy = await PDFDocument.load(result.buffer);
    assert.equal(copy.getPageCount(), 1);
    assert.deepEqual(copy.getPage(0).getSize(), { width: 612, height: 792 });
  } finally {
    scanOcr.execute = originalExecute;
  }
});

test('does not present an unchanged PDF as redacted', async () => {
  const { createPeselRedactedCopy } = require('../dist/modules/attachments/pdf-redaction.service');
  await assert.rejects(createPeselRedactedCopy(Buffer.from('not a pdf')), { statusCode: 400 });
});
