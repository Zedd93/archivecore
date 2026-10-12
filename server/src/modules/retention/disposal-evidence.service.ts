import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { prisma } from '../../config/database';
import { deleteFile, downloadFile, uploadFile } from '../../config/minio';

const MAX_EVIDENCE_FILES = 5;
const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;

const storage = { uploadFile, downloadFile, deleteFile };

function imageType(file: Express.Multer.File): 'image/jpeg' | 'image/png' {
  const buffer = file.buffer;
  const png = buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const mimeType = png ? 'image/png' : jpeg ? 'image/jpeg' : null;
  if (!mimeType || file.mimetype !== mimeType || buffer.length === 0 || buffer.length > MAX_EVIDENCE_BYTES) {
    throw Object.assign(new Error('Zdjęcie musi być poprawnym plikiem JPEG lub PNG o rozmiarze do 5 MB'), { statusCode: 400 });
  }
  try {
    const document = new PDFDocument({ autoFirstPage: false }) as unknown as {
      openImage(data: Buffer): { width: number; height: number };
    };
    const image = document.openImage(buffer);
    if (image.width * image.height > 25_000_000 || image.width > 8000 || image.height > 8000) {
      throw new Error('Obraz ma zbyt duże wymiary');
    }
  } catch {
    throw Object.assign(new Error('Zdjęcie jest uszkodzone lub ma zbyt duże wymiary'), { statusCode: 400 });
  }
  return mimeType;
}

function checksum(buffer: Buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export class DisposalEvidenceService {
  constructor(private readonly db = prisma, private readonly objectStorage = storage) {}

  private async assertBatch(tenantId: string, batchId: string) {
    const batch = await this.db.auditLog.findFirst({
      where: { tenantId, entityId: batchId, entityType: 'disposal_batch', action: 'disposal.batch_completed' },
      select: { id: true },
    });
    if (!batch) throw Object.assign(new Error('Zakończone brakowanie nie zostało znalezione'), { statusCode: 404 });
  }

  async upload(tenantId: string, batchId: string, userId: string, file: Express.Multer.File) {
    await this.assertBatch(tenantId, batchId);
    const mimeType = imageType(file);
    const count = await this.db.disposalEvidence.count({ where: { tenantId, batchId } });
    if (count >= MAX_EVIDENCE_FILES) {
      throw Object.assign(new Error('Do jednej operacji można dodać maksymalnie 5 zdjęć'), { statusCode: 409 });
    }
    const checksumSha256 = checksum(file.buffer);
    const duplicate = await this.db.disposalEvidence.findFirst({ where: { tenantId, batchId, checksumSha256 }, select: { id: true } });
    if (duplicate) throw Object.assign(new Error('To zdjęcie jest już przypisane do tego brakowania'), { statusCode: 409 });

    const fileName = path.basename(file.originalname.replace(/\\/g, '/')).slice(0, 500) || 'zdjecie';
    const storageKey = `${tenantId}/disposal/${batchId}/${randomUUID()}.${mimeType === 'image/png' ? 'png' : 'jpg'}`;
    await this.objectStorage.uploadFile(storageKey, file.buffer, mimeType);
    try {
      return await this.db.disposalEvidence.create({
        data: { tenantId, batchId, fileName, storageKey, mimeType, fileSize: file.buffer.length, checksumSha256, uploadedById: userId },
        select: { id: true, fileName: true, mimeType: true, fileSize: true, checksumSha256: true, uploadedAt: true },
      });
    } catch (error) {
      await this.objectStorage.deleteFile(storageKey).catch(() => undefined);
      throw error;
    }
  }

  async list(tenantId: string, batchId: string) {
    await this.assertBatch(tenantId, batchId);
    return this.db.disposalEvidence.findMany({
      where: { tenantId, batchId },
      orderBy: [{ uploadedAt: 'asc' }, { id: 'asc' }],
      select: { id: true, fileName: true, mimeType: true, fileSize: true, checksumSha256: true, uploadedAt: true, uploadedBy: { select: { firstName: true, lastName: true } } },
    });
  }

  async download(tenantId: string, batchId: string, evidenceId: string) {
    const evidence = await this.db.disposalEvidence.findFirst({
      where: { id: evidenceId, tenantId, batchId },
      select: { id: true, storageKey: true, mimeType: true, checksumSha256: true },
    });
    if (!evidence) throw Object.assign(new Error('Zdjęcie nie zostało znalezione'), { statusCode: 404 });
    const buffer = await this.objectStorage.downloadFile(evidence.storageKey);
    if (checksum(buffer) !== evidence.checksumSha256) throw new Error('Suma kontrolna zdjęcia nie zgadza się z zapisem');
    return { buffer, mimeType: evidence.mimeType };
  }

  async forPdf(tenantId: string, batchId: string) {
    const evidence = await this.db.disposalEvidence.findMany({
      where: { tenantId, batchId },
      orderBy: [{ uploadedAt: 'asc' }, { id: 'asc' }],
      select: { id: true, storageKey: true, fileName: true, checksumSha256: true, uploadedAt: true },
    });
    return Promise.all(evidence.map(async (item) => {
      const buffer = await this.objectStorage.downloadFile(item.storageKey);
      if (checksum(buffer) !== item.checksumSha256) throw new Error('Suma kontrolna zdjęcia nie zgadza się z zapisem');
      return { fileName: item.fileName, checksumSha256: item.checksumSha256, uploadedAt: item.uploadedAt, buffer };
    }));
  }
}

export const disposalEvidenceService = new DisposalEvidenceService();
