import { execFile } from 'child_process';
import { access, mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

const run = promisify(execFile);
const MAX_SCAN_BYTES = 10 * 1024 * 1024;
const MAX_PAGES = 12;

type ScanKind = 'pdf' | 'png' | 'jpeg' | 'tiff';

export function scanKind(buffer: Buffer): ScanKind {
  if (buffer.subarray(0, 5).toString() === '%PDF-') return 'pdf';
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer.subarray(0, 4).equals(Buffer.from([73, 73, 42, 0]))
    || buffer.subarray(0, 4).equals(Buffer.from([77, 77, 0, 42]))) return 'tiff';
  throw Object.assign(new Error('Obsługiwane skany: PDF, PNG, JPG lub TIFF'), { statusCode: 400 });
}

async function execute(binary: string, args: string[], timeout: number): Promise<string> {
  try {
    const { stdout } = await run(binary, args, {
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

export async function recognizeScan(buffer: Buffer, requestedPage?: number): Promise<{ text: string; pages: number }> {
  if (!buffer.length || buffer.length > MAX_SCAN_BYTES) {
    throw Object.assign(new Error('Skan musi mieć od 1 B do 10 MB'), { statusCode: 400 });
  }
  const kind = scanKind(buffer);
  if (requestedPage !== undefined && (!Number.isInteger(requestedPage) || requestedPage < 1)) {
    throw Object.assign(new Error('Nieprawidłowy numer strony skanu'), { statusCode: 400 });
  }
  const directory = await mkdtemp(path.join(os.tmpdir(), 'archivecore-ocr-'));
  try {
    const source = path.join(directory, `source.${kind === 'jpeg' ? 'jpg' : kind}`);
    await writeFile(source, buffer);
    let pageCount = 1;
    if (kind === 'pdf') {
      const info = await execute('pdfinfo', [source], 10000);
      pageCount = Number(info.match(/^Pages:\s+(\d+)/m)?.[1]);
      if (!Number.isInteger(pageCount) || pageCount < 1) {
        throw Object.assign(new Error('Nie można ustalić liczby stron PDF'), { statusCode: 422 });
      }
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
    for (const page of pagesToRead) {
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
      const text = await execute('tesseract', [image, 'stdout', '-l', 'pol+eng', '--psm', '6', '-c', 'preserve_interword_spaces=1'], 20000);
      parts.push(text.trim());
      if (kind === 'pdf') await rm(image, { force: true });
    }
    const text = parts.join('\n\n');
    if (!parts.some(Boolean) && requestedPage === undefined) throw Object.assign(new Error('OCR nie odczytał tekstu. Sprawdź jakość i orientację skanu.'), { statusCode: 422 });
    return { text, pages: pageCount };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
