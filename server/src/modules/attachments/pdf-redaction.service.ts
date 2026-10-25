import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import { PNG } from 'pngjs';
import { containsPesel, execute, ocrTessdataArgs } from '../import-export/scan-ocr.service';

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_PAGES = 12;
const RENDER_DPI = 140;
const MAX_RENDER_DIMENSION = 3500;

type Box = { x: number; y: number; width: number; height: number };

function invalid(message: string, statusCode = 422): Error {
  return Object.assign(new Error(message), { statusCode });
}

export function peselBoxesFromTsv(tsv: string): Box[] {
  const boxes: Box[] = [];
  for (const line of tsv.split(/\r?\n/).slice(1)) {
    const columns = line.split('\t');
    if (columns.length < 12 || !containsPesel(columns.slice(11).join('\t'))) continue;
    const [x, y, width, height] = [6, 7, 8, 9].map((index) => Number(columns[index]));
    if ([x, y, width, height].every(Number.isInteger) && x >= 0 && y >= 0 && width > 0 && height > 0) {
      boxes.push({ x, y, width, height });
    }
  }
  return boxes;
}

export function blackOutPng(source: Buffer, boxes: Box[]): Buffer {
  const png = PNG.sync.read(source);
  for (const box of boxes) {
    const left = Math.max(0, box.x - 3);
    const top = Math.max(0, box.y - 3);
    const right = Math.min(png.width, box.x + box.width + 3);
    const bottom = Math.min(png.height, box.y + box.height + 3);
    for (let y = top; y < bottom; y++) {
      for (let x = left; x < right; x++) {
        const offset = (y * png.width + x) * 4;
        png.data[offset] = 0;
        png.data[offset + 1] = 0;
        png.data[offset + 2] = 0;
        png.data[offset + 3] = 255;
      }
    }
  }
  return PNG.sync.write(png);
}

export async function createPeselRedactedCopy(source: Buffer): Promise<{ buffer: Buffer; redactedCount: number }> {
  if (source.length === 0 || source.length > MAX_BYTES || source.subarray(0, 5).toString() !== '%PDF-') {
    throw invalid('Wybierz plik PDF do 10 MB', 400);
  }
  let original: PDFDocument;
  try {
    original = await PDFDocument.load(source);
  } catch {
    throw invalid('Nie można odczytać pliku PDF lub jest on zabezpieczony hasłem');
  }
  const pageCount = original.getPageCount();
  if (pageCount === 0 || pageCount > MAX_PAGES) {
    throw invalid(`Kopia może mieć maksymalnie ${MAX_PAGES} stron. Podziel większy plik.`, 400);
  }

  const directory = await mkdtemp(path.join(os.tmpdir(), 'archivecore-redact-'));
  try {
    const input = path.join(directory, 'source.pdf');
    await writeFile(input, source);
    const output = await PDFDocument.create();
    let redactedCount = 0;
    for (let page = 1; page <= pageCount; page++) {
      const prefix = path.join(directory, `page-${page}`);
      const imagePath = `${prefix}.png`;
      await execute('pdftoppm', ['-f', String(page), '-l', String(page), '-singlefile', '-r', String(RENDER_DPI), '-scale-to', String(MAX_RENDER_DIMENSION), '-png', input, prefix], 30000);
      const image = await readFile(imagePath);
      const tsv = await execute('tesseract', [imagePath, 'stdout', ...ocrTessdataArgs(), '-l', 'pol+eng', '--psm', '6', '-c', 'tessedit_create_tsv=1'], 30000);
      const boxes = peselBoxesFromTsv(tsv);
      redactedCount += boxes.length;
      const flattened = await output.embedPng(blackOutPng(image, boxes));
      const originalPage = original.getPage(page - 1);
      const rotation = originalPage.getRotation().angle % 180;
      const width = rotation === 0 ? originalPage.getWidth() : originalPage.getHeight();
      const height = rotation === 0 ? originalPage.getHeight() : originalPage.getWidth();
      const pdfPage = output.addPage([width, height]);
      pdfPage.drawImage(flattened, { x: 0, y: 0, width: pdfPage.getWidth(), height: pdfPage.getHeight() });
      await rm(imagePath, { force: true });
    }
    if (redactedCount === 0) throw invalid('Nie wykryto numeru PESEL. Kopia nie została utworzona; sprawdź dokument ręcznie.');
    return { buffer: Buffer.from(await output.save()), redactedCount };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
