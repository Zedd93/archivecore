import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { access, mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

const run = promisify(execFile);
const MAX_SCAN_BYTES = 10 * 1024 * 1024;
const MAX_PAGES = 12;
const WINDOWS_OCR_DIR = 'C:\\Apps\\ocr-tools\\runtime\\Library\\bin';
const WINDOWS_TESSDATA_DIR = 'C:\\Apps\\ocr-tools\\runtime\\share\\tessdata';

type ScanKind = 'pdf' | 'png' | 'jpeg' | 'tiff';
type PageDiagnostic = { page: number; source: 'embedded' | 'ocr'; reviewFlag: 'empty' | 'short' | 'replacement' | null; containsPesel: boolean };

type PdfTextItem = { str: string; transform: number[] };

function textFromPdfItems(items: PdfTextItem[]): string {
  const positioned = items.filter((item) => item.str.trim()).map((item) => ({
    text: item.str.replace(/\s+/g, ' ').trim(), x: item.transform[4], y: item.transform[5],
  })).sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: { y: number; items: typeof positioned }[] = [];
  for (const item of positioned) {
    const line = lines.at(-1);
    if (line && Math.abs(line.y - item.y) <= 2) line.items.push(item);
    else lines.push({ y: item.y, items: [item] });
  }
  return lines.map((line) => line.items.sort((a, b) => a.x - b.x).map((item) => item.text).join(' ')).join('\n');
}

async function loadPdf(buffer: Buffer) {
  // TypeScript emits require() for dynamic imports in this CommonJS server; PDF.js is ESM-only.
  const pdfjs = await (new Function('return import("pdfjs-dist/legacy/build/pdf.mjs")') as () => Promise<any>)();
  try {
    return await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, isEvalSupported: false }).promise;
  } catch {
    throw Object.assign(new Error('Nie udało się otworzyć PDF. Sprawdź, czy plik nie jest uszkodzony lub zaszyfrowany.'), { statusCode: 422 });
  }
}

export function scanKind(buffer: Buffer): ScanKind {
  if (buffer.subarray(0, 5).toString() === '%PDF-') return 'pdf';
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer.subarray(0, 4).equals(Buffer.from([73, 73, 42, 0]))
    || buffer.subarray(0, 4).equals(Buffer.from([77, 77, 0, 42]))) return 'tiff';
  throw Object.assign(new Error('Obsługiwane skany: PDF, PNG, JPG lub TIFF'), { statusCode: 400 });
}

async function execute(binary: string, args: string[], timeout: number): Promise<string> {
  const configuredDir = process.env.OCR_BIN_DIR;
  const installedDir = process.platform === 'win32' ? WINDOWS_OCR_DIR : undefined;
  const candidate = configuredDir || installedDir;
  const executable = candidate && path.join(candidate, `${binary}${process.platform === 'win32' ? '.exe' : ''}`);
  try {
    const { stdout } = await run(executable && existsSync(executable) ? executable : binary, args, {
      timeout,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
    });
    return stdout;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      throw Object.assign(new Error(`Na serwerze brakuje programu ${binary}. Skontaktuj się z administratorem.`), { statusCode: 503 });
    }
    if (error.killed) {
      throw Object.assign(new Error('Odczyt skanu przekroczył limit czasu. Spróbuj mniejszego pliku.'), { statusCode: 422 });
    }
    throw Object.assign(new Error(`Nie udało się odczytać skanu (${binary}). Sprawdź format pliku i instalację OCR.`), { statusCode: 422 });
  }
}

function scanReviewFlag(text: string): PageDiagnostic['reviewFlag'] {
  const content = text.replace(/\s/g, '');
  if (!content.length) return 'empty';
  if (content.includes('\uFFFD')) return 'replacement';
  if (content.length < 80) return 'short';
  return null;
}

export function containsPesel(text: string): boolean {
  const weights = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
  for (const match of text.matchAll(/(?<!\d)\d{11}(?!\d)/g)) {
    const digits = [...match[0]].map(Number);
    const checksum = (10 - weights.reduce((sum, weight, index) => sum + weight * digits[index], 0) % 10) % 10;
    if (checksum === digits[10]) return true;
  }
  return false;
}

export async function recognizeScan(buffer: Buffer, requestedPage?: number): Promise<{ text: string; pages: number; pageDiagnostics: PageDiagnostic[] }> {
  if (!buffer.length || buffer.length > MAX_SCAN_BYTES) {
    throw Object.assign(new Error('Skan musi mieć od 1 B do 10 MB'), { statusCode: 400 });
  }
  const kind = scanKind(buffer);
  if (requestedPage !== undefined && (!Number.isInteger(requestedPage) || requestedPage < 1)) {
    throw Object.assign(new Error('Nieprawidłowy numer strony skanu'), { statusCode: 400 });
  }
  const directory = await mkdtemp(path.join(os.tmpdir(), 'archivecore-ocr-'));
  let pdf: Awaited<ReturnType<typeof loadPdf>> | undefined;
  try {
    const source = path.join(directory, `source.${kind === 'jpeg' ? 'jpg' : kind}`);
    await writeFile(source, buffer);
    let pageCount = 1;
    if (kind === 'pdf') {
      pdf = await loadPdf(buffer);
      pageCount = pdf.numPages;
      if (pageCount > MAX_PAGES) {
        throw Object.assign(new Error(`Skan PDF może mieć maksymalnie ${MAX_PAGES} stron. Podziel większy spis na mniejsze pliki.`), { statusCode: 400 });
      }
      if (requestedPage === undefined && pageCount > 3) {
        throw Object.assign(new Error('Dla PDF powyżej 3 stron odczytuj jedną stronę na żądanie'), { statusCode: 400 });
      }
    }
    if (requestedPage !== undefined && requestedPage > pageCount) {
      throw Object.assign(new Error('Numer strony przekracza liczbę stron skanu'), { statusCode: 400 });
    }
    const pagesToRead = requestedPage === undefined
      ? Array.from({ length: pageCount }, (_, index) => index + 1)
      : [requestedPage];
    const parts: string[] = [];
    const pageDiagnostics: PageDiagnostic[] = [];
    for (const page of pagesToRead) {
      if (pdf) {
        const pdfPage = await pdf.getPage(page);
        const { items } = await pdfPage.getTextContent();
        const embeddedText = textFromPdfItems(items.filter((item: unknown): item is PdfTextItem =>
          typeof item === 'object' && item !== null && 'str' in item && 'transform' in item));
        pdfPage.cleanup();
        if (embeddedText.trim().length >= 40) {
          parts.push(embeddedText);
          pageDiagnostics.push({ page, source: 'embedded', reviewFlag: null, containsPesel: containsPesel(embeddedText) });
          continue;
        }
      }
      let image = source;
      if (kind === 'pdf') {
        const prefix = path.join(directory, `page-${page}`);
        image = `${prefix}.png`;
        await execute('pdftoppm', ['-f', String(page), '-l', String(page), '-singlefile', '-r', '180', '-scale-to', '3500', '-png', source, prefix], 25000);
        try {
          await access(image);
        } catch {
          throw Object.assign(new Error(`Nie udało się przygotować strony ${page} PDF do odczytu`), { statusCode: 422 });
        }
      }
      const tessdataDir = process.env.OCR_TESSDATA_DIR
        || (process.platform === 'win32' && existsSync(WINDOWS_TESSDATA_DIR) ? WINDOWS_TESSDATA_DIR : undefined);
      const text = await execute('tesseract', [image, 'stdout',
        ...(tessdataDir ? ['--tessdata-dir', tessdataDir] : []),
        '-l', 'pol+eng', '--psm', '6', '-c', 'preserve_interword_spaces=1'], 20000);
      parts.push(text.trim());
      pageDiagnostics.push({ page, source: 'ocr', reviewFlag: scanReviewFlag(text), containsPesel: containsPesel(text) });
      if (kind === 'pdf') await rm(image, { force: true });
    }
    const text = parts.join('\n\n');
    if (!parts.some(Boolean) && requestedPage === undefined) throw Object.assign(new Error('OCR nie odczytał tekstu. Sprawdź jakość i orientację skanu.'), { statusCode: 422 });
    return { text, pages: pageCount, pageDiagnostics };
  } finally {
    if (pdf) await pdf.destroy();
    await rm(directory, { recursive: true, force: true });
  }
}
