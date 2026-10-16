import { execFile } from 'child_process';
import crypto from 'crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { PrismaClient } from '@prisma/client';
import { parseFolderQrData } from '@archivecore/shared';
import jsQR from 'jsqr';
import { PDFDocument } from 'pdf-lib';
import { PNG } from 'pngjs';
import { z } from 'zod';
import { prisma } from '../../config/database';
import { deleteFile, uploadFile } from '../../config/minio';

const run = promisify(execFile);
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_PAGES = 20;
const MAX_SEGMENTS = 10;

function invalid(message: string, statusCode = 422): Error {
  return Object.assign(new Error(message), { statusCode });
}

type Segment = {
  folderId: string;
  folderNumber: string;
  title: string;
  coverPage: number;
  firstPage: number;
  lastPage: number;
  source: 'qr' | 'manual';
};

type Preview = {
  checksumSha256: string;
  planHash: string;
  pageCount: number;
  segments: Segment[];
};

const overrideSchema = z.array(z.object({
  page: z.number().int().min(1).max(MAX_PAGES),
  folderId: z.string().uuid(),
}).strict()).max(MAX_SEGMENTS);

function parseOverrides(input: unknown) {
  let value = input ?? [];
  if (typeof value === 'string') {
    try { value = JSON.parse(value); }
    catch { throw invalid('Nieprawidłowa lista ręcznych separatorów', 400); }
  }
  const result = overrideSchema.safeParse(value);
  if (!result.success) throw invalid('Podaj numer strony i istniejącą teczkę dla każdego ręcznego separatora', 400);
  const pages = new Set(result.data.map((item) => item.page));
  if (pages.size !== result.data.length) throw invalid('Jedna strona nie może być wskazana dwa razy', 400);
  return result.data;
}

async function readQrCodes(buffer: Buffer, pageCount: number): Promise<Array<string | null>> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'archivecore-scan-batch-'));
  try {
    const source = path.join(directory, 'source.pdf');
    const prefix = path.join(directory, 'page');
    await writeFile(source, buffer);
    try {
      await run('pdftoppm', ['-f', '1', '-l', String(pageCount), '-scale-to', '1500', '-png', source, prefix], {
        timeout: 120_000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      });
    } catch (error: any) {
      if (error.code === 'ENOENT') throw invalid('Na serwerze brakuje programu pdftoppm', 503);
      throw invalid('Nie udało się odczytać stron wsadu PDF');
    }

    const names = (await readdir(directory))
      .filter((name) => /^page-\d+\.png$/.test(name))
      .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
    if (names.length !== pageCount) throw invalid('Nie udało się odczytać wszystkich stron PDF');
    const codes: Array<string | null> = [];
    for (const name of names) {
      const png = PNG.sync.read(await readFile(path.join(directory, name)));
      const pixels = new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.byteLength);
      codes.push(jsQR(pixels, png.width, png.height, { inversionAttempts: 'dontInvert' })?.data ?? null);
    }
    return codes;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export class ScanBatchService {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly storage: { uploadFile: typeof uploadFile; deleteFile: typeof deleteFile } = { uploadFile, deleteFile },
    private readonly codeReader: typeof readQrCodes = readQrCodes,
  ) {}

  async preview(file: Express.Multer.File, tenantId: string, department?: string, overrides: unknown = []): Promise<Preview> {
    if (!file.buffer.length || file.buffer.length > MAX_BYTES || file.buffer.subarray(0, 5).toString() !== '%PDF-') {
      throw invalid('Wybierz prawidłowy plik PDF do 20 MB', 400);
    }

    let pdf: PDFDocument;
    try {
      pdf = await PDFDocument.load(file.buffer);
    } catch {
      throw invalid('Nie można odczytać pliku PDF lub jest on zabezpieczony hasłem');
    }
    const pageCount = pdf.getPageCount();
    if (pageCount < 2 || pageCount > MAX_PAGES) {
      throw invalid(`Wsad musi mieć od 2 do ${MAX_PAGES} stron`, 400);
    }
    const manualSeparators = parseOverrides(overrides);
    if (manualSeparators.some((item) => item.page > pageCount)) {
      throw invalid('Numer ręcznego separatora przekracza liczbę stron PDF', 400);
    }
    const byPage = new Map(manualSeparators.map((item) => [item.page, item.folderId]));

    const segments: Array<Omit<Segment, 'folderNumber' | 'title'>> = [];
    const codes = await this.codeReader(file.buffer, pageCount);
    if (codes.length !== pageCount) throw invalid('Nie udało się odczytać wszystkich stron PDF');
    for (let index = 0; index < codes.length; index++) {
      const code = codes[index];
      const page = index + 1;
      const manualFolderId = byPage.get(page);
      const folderQr = code ? parseFolderQrData(code) : null;
      if (folderQr?.isValid && manualFolderId) {
        throw invalid(`Strona ${page}: poprawnego kodu QR nie można zastąpić ręcznym przypisaniem`, 409);
      }
      if (code && !folderQr?.isValid && !manualFolderId) {
        throw invalid(`Strona ${page}: kod QR jest nieczytelny lub nie należy do teczki. Wskaż ręczny separator po sprawdzeniu PDF`);
      }
      const folderId = manualFolderId || folderQr?.folderId;
      if (!folderId) {
        if (!segments.length) throw invalid('Pierwsza strona musi być separatorem teczki. Jeśli QR jest nieczytelny, wskaż ją ręcznie');
        continue;
      }
      const previous = segments.at(-1);
      if (previous) {
        previous.lastPage = index;
        if (previous.lastPage < previous.firstPage) throw invalid(`Separator na stronie ${previous.coverPage} nie ma stron dokumentu`);
      }
      segments.push({ folderId, coverPage: page, firstPage: page + 1, lastPage: pageCount, source: manualFolderId ? 'manual' : 'qr' });
      if (segments.length > MAX_SEGMENTS) throw invalid(`Wsad może zawierać maksymalnie ${MAX_SEGMENTS} teczek`, 400);
    }
    const last = segments.at(-1);
    if (!last || last.firstPage > pageCount) throw invalid('Ostatni separator nie ma stron dokumentu');

    const folderIds = [...new Set(segments.map((segment) => segment.folderId))];
    const folders = await this.db.folder.findMany({
      where: {
        id: { in: folderIds },
        tenantId,
        status: 'active',
        ...(department ? { box: { department: { equals: department, mode: 'insensitive' } } } : {}),
      },
      select: { id: true, folderNumber: true, title: true },
    });
    if (folders.length !== folderIds.length) {
      throw invalid('Jedna z teczek z kodu QR nie istnieje lub nie masz do niej dostępu', 403);
    }
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    const checksumSha256 = crypto.createHash('sha256').update(file.buffer).digest('hex');
    const planHash = crypto.createHash('sha256').update(JSON.stringify({
      checksumSha256,
      segments: segments.map(({ coverPage, folderId, firstPage, lastPage, source }) => ({ coverPage, folderId, firstPage, lastPage, source })),
    })).digest('hex');
    return {
      checksumSha256,
      planHash,
      pageCount,
      segments: segments.map((segment) => ({ ...segment, ...byId.get(segment.folderId)! })),
    };
  }

  async commit(file: Express.Multer.File, tenantId: string, userId: string, expectedChecksum: string, department?: string, overrides: unknown = [], expectedPlanHash?: string) {
    const preview = await this.preview(file, tenantId, department, overrides);
    if (!/^[a-f0-9]{64}$/.test(expectedChecksum) || preview.checksumSha256 !== expectedChecksum) {
      throw invalid('Plik zmienił się od podglądu. Odczytaj wsad ponownie', 409);
    }
    if ((preview.segments.some((segment) => segment.source === 'manual') && !expectedPlanHash)
      || (expectedPlanHash && preview.planHash !== expectedPlanHash)) {
      throw invalid('Przypisanie stron zmieniło się od podglądu. Sprawdź wsad ponownie', 409);
    }

    const source = await PDFDocument.load(file.buffer);
    const uploadedKeys: string[] = [];
    const pending: Array<{ segment: Segment; key: string; bytes: Buffer; fileName: string }> = [];
    const now = new Date();
    const baseName = path.basename(file.originalname.replace(/\\/g, '/')).replace(/\.pdf$/i, '').slice(0, 100) || 'skan';
    try {
      for (const segment of preview.segments) {
        const output = await PDFDocument.create();
        const indexes = Array.from({ length: segment.lastPage - segment.firstPage + 1 }, (_, index) => segment.firstPage - 1 + index);
        const pages = await output.copyPages(source, indexes);
        for (const page of pages) output.addPage(page);
        const bytes = Buffer.from(await output.save());
        const key = `${tenantId}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}.pdf`;
        const fileName = `${baseName}_strony_${segment.firstPage}-${segment.lastPage}.pdf`;
        uploadedKeys.push(key);
        await this.storage.uploadFile(key, bytes, 'application/pdf');
        pending.push({ segment, key, bytes, fileName });
      }

      const attachments = await this.db.$transaction(async (tx) => {
        const created = [];
        for (const item of pending) {
          created.push(await tx.attachment.create({
            data: {
              tenantId,
              folderId: item.segment.folderId,
              fileName: item.fileName,
              filePath: item.key,
              fileSize: BigInt(item.bytes.length),
              mimeType: 'application/pdf',
              checksumSha256: crypto.createHash('sha256').update(item.bytes).digest('hex'),
              uploadedBy: userId,
            },
            select: { id: true, folderId: true, fileName: true },
          }));
        }
        return created;
      }, { timeout: 10_000 });
      return { pageCount: preview.pageCount, attachments };
    } catch (error) {
      const cleanup = await Promise.allSettled(uploadedKeys.map((key) => this.storage.deleteFile(key)));
      for (const [index, result] of cleanup.entries()) {
        if (result.status === 'rejected') console.error('Scan batch cleanup failed:', uploadedKeys[index], result.reason);
      }
      throw error;
    }
  }
}

export const scanBatchService = new ScanBatchService();
