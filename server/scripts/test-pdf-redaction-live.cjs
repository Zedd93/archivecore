const assert = require('node:assert/strict');
const { mkdtemp, writeFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const { createPeselRedactedCopy, peselBoxesFromTsv } = require('../dist/modules/attachments/pdf-redaction.service');
const { containsPesel, execute, ocrTessdataArgs } = require('../dist/modules/import-export/scan-ocr.service');

function syntheticPesel() {
  const prefix = '0021011234';
  const weights = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
  const sum = [...prefix].reduce((total, digit, index) => total + Number(digit) * weights[index], 0);
  return `${prefix}${(10 - sum % 10) % 10}`;
}

async function main() {
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  page.drawText(`PESEL: ${syntheticPesel()}`, {
    x: 72,
    y: 690,
    size: 32,
    font: await document.embedFont(StandardFonts.Helvetica),
  });
  const original = Buffer.from(await document.save());
  const unchangedOriginal = Buffer.from(original);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'archivecore-redaction-check-'));
  try {
    const originalFile = path.join(directory, 'original.pdf');
    const originalPrefix = path.join(directory, 'original');
    await writeFile(originalFile, original);
    await execute('pdftoppm', ['-f', '1', '-l', '1', '-singlefile', '-r', '140', '-scale-to', '3500', '-png', originalFile, originalPrefix], 30000);
    const originalTsv = await execute('tesseract', [`${originalPrefix}.png`, 'stdout', ...ocrTessdataArgs(), '-l', 'pol+eng', '--psm', '6', 'tsv'], 30000);
    const recognizedWords = originalTsv.split(/\r?\n/).slice(1).map((line) => line.split('\t').slice(11).join('\t')).filter(Boolean);
    assert.equal(peselBoxesFromTsv(originalTsv).length, 1, `OCR pliku źródłowego: ${recognizedWords.join(' | ')}`);

    const { buffer, redactedCount } = await createPeselRedactedCopy(original);
    assert.equal(redactedCount, 1, 'OCR musi wykryć numer w pliku źródłowym');
    assert.deepEqual(original, unchangedOriginal);
    assert.equal((await PDFDocument.load(buffer)).getPageCount(), 1);
    const file = path.join(directory, 'copy.pdf');
    const prefix = path.join(directory, 'copy');
    await writeFile(file, buffer);
    await execute('pdftoppm', ['-f', '1', '-l', '1', '-singlefile', '-r', '140', '-png', file, prefix], 30000);
    const text = await execute('tesseract', [`${prefix}.png`, 'stdout', ...ocrTessdataArgs(), '-l', 'pol+eng', '--psm', '6'], 30000);
    assert.equal(containsPesel(text), false, 'OCR nie może odczytać PESEL z kopii');
    console.log('OK: syntetyczny PDF zakrywa PESEL w spłaszczonej kopii; oryginał pozostał bez zmian.');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('Test rzeczywistego OCR nie powiódł się:', error);
  process.exitCode = 1;
});
