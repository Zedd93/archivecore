import { execFile } from 'child_process';
import { mkdtemp, readdir, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

const run = promisify(execFile);
const MAX_SCAN_BYTES = 10 * 1024 * 1024;
const MAX_PAGES = 3;

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

export async function recognizeScan(buffer: Buffer): Promise<{ text: string; pages: number }> {
  if (!buffer.length || buffer.length > MAX_SCAN_BYTES) {
    throw Object.assign(new Error('Skan musi mieć od 1 B do 10 MB'), { statusCode: 400 });
  }
  const kind = scanKind(buffer);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'archivecore-ocr-'));
  try {
    const source = path.join(directory, `source.${kind === 'jpeg' ? 'jpg' : kind}`);
    await writeFile(source, buffer);
    let images = [source];
    if (kind === 'pdf') {
      const info = await execute('pdfinfo', [source], 10000);
      const pageCount = Number(info.match(/^Pages:\s+(\d+)/m)?.[1]);
      if (!Number.isInteger(pageCount) || pageCount < 1) {
        throw Object.assign(new Error('Nie można ustalić liczby stron PDF'), { statusCode: 422 });
      }
      if (pageCount > MAX_PAGES) {
        throw Object.assign(new Error(`Skan PDF może mieć maksymalnie ${MAX_PAGES} strony. Import większego spisu jako jednej całości nie jest jeszcze obsługiwany.`), { statusCode: 400 });
      }
      const prefix = path.join(directory, 'page');
      await execute('pdftoppm', ['-f', '1', '-l', String(MAX_PAGES), '-r', '180', '-png', source, prefix], 60000);
      images = (await readdir(directory))
        .filter((name) => /^page-\d+\.png$/.test(name))
        .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))
        .map((name) => path.join(directory, name));
      if (images.length === 0) throw Object.assign(new Error('PDF nie zawiera stron możliwych do odczytu'), { statusCode: 422 });
    }
    const parts: string[] = [];
    for (const image of images) {
      const text = await execute('tesseract', [image, 'stdout', '-l', 'pol+eng', '--psm', '6', '-c', 'preserve_interword_spaces=1'], 30000);
      parts.push(text.trim());
    }
    const text = parts.filter(Boolean).join('\n\n');
    if (!text) throw Object.assign(new Error('OCR nie odczytał tekstu. Sprawdź jakość i orientację skanu.'), { statusCode: 422 });
    return { text, pages: images.length };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
