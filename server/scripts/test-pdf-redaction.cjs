const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs/promises');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const { PNG } = require('pngjs');

function whitePng() {
  const png = new PNG({ width: 120, height: 60 });
  png.data.fill(255);
  return PNG.sync.write(png);
}

test('refuses to issue a copy when OCR did not detect a number', async () => {
  const originalExecFile = childProcess.execFile;
  const tsv = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n';
  childProcess.execFile = (_binary, args, _options, callback) => {
    if (/pdftoppm(?:\.exe)?$/i.test(String(_binary))) {
      fs.writeFile(`${args.at(-1)}.png`, whitePng()).then(() => callback(null, { stdout: '' }), callback);
      return;
    }
    if (/tesseract(?:\.exe)?$/i.test(String(_binary))) return callback(null, { stdout: tsv });
    callback(new Error(`Unexpected binary: ${_binary}`));
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
    childProcess.execFile = originalExecFile;
  }
});

test('redaction paints selected pixels black without changing other pixels', () => {
  const { blackOutPng, peselBoxesFromTsv } = require('../dist/modules/attachments/pdf-redaction.service');
  const pixels = PNG.sync.read(blackOutPng(whitePng(), [{ x: 10, y: 10, width: 70, height: 12 }]));
  assert.deepEqual([...pixels.data.subarray((15 * pixels.width + 15) * 4, (15 * pixels.width + 15) * 4 + 4)], [0, 0, 0, 255]);
  assert.deepEqual([...pixels.data.subarray(0, 4)], [255, 255, 255, 255]);
  assert.deepEqual(peselBoxesFromTsv('level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n5\t1\t1\t1\t1\t1\t0\t0\t40\t10\t95\texample'), []);
});

test('does not present an unchanged PDF as redacted', async () => {
  const { createPeselRedactedCopy } = require('../dist/modules/attachments/pdf-redaction.service');
  await assert.rejects(createPeselRedactedCopy(Buffer.from('not a pdf')), { statusCode: 400 });
});
