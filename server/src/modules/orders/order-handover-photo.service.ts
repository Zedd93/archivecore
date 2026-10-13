import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { prisma } from '../../config/database';
import { deleteFile, downloadFile, uploadFile } from '../../config/minio';

const MAX_PHOTOS = 10;
const MAX_BYTES = 5 * 1024 * 1024;
const storage = { uploadFile, downloadFile, deleteFile };

function checksum(buffer: Buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function imageType(file: Express.Multer.File): 'image/jpeg' | 'image/png' {
  const buffer = file.buffer;
  const png = buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const mimeType = png ? 'image/png' : jpeg ? 'image/jpeg' : null;
  if (!mimeType || file.mimetype !== mimeType || buffer.length > MAX_BYTES) {
    throw Object.assign(new Error('Zdjęcie musi być poprawnym plikiem JPEG lub PNG o rozmiarze do 5 MB'), { statusCode: 400 });
  }
  try {
    const document = new PDFDocument({ autoFirstPage: false }) as unknown as {
      openImage(data: Buffer): { width: number; height: number };
    };
    const image = document.openImage(buffer);
    if (image.width * image.height > 25_000_000 || image.width > 8000 || image.height > 8000) throw new Error('Image too large');
  } catch {
    throw Object.assign(new Error('Zdjęcie jest uszkodzone lub ma zbyt duże wymiary'), { statusCode: 400 });
  }
  return mimeType;
}

export class OrderHandoverPhotoService {
  constructor(private readonly db = prisma, private readonly objectStorage = storage) {}

  private async assertProof(tenantId: string, orderId: string) {
    const proof = await this.db.orderHandoverProof.findFirst({
      where: { orderId, order: { tenantId, status: { in: ['delivered', 'completed'] } } },
      select: { orderId: true },
    });
    if (!proof) throw Object.assign(new Error('Potwierdzenie przekazania nie zostało znalezione'), { statusCode: 404 });
  }

  async upload(tenantId: string, orderId: string, userId: string, file: Express.Multer.File, boxId?: string) {
    await this.assertProof(tenantId, orderId);
    if (boxId) {
      const check = await this.db.orderHandoverBox.findUnique({ where: { orderId_boxId: { orderId, boxId } }, select: { boxId: true } });
      if (!check) throw Object.assign(new Error('Karton nie należy do potwierdzenia przekazania'), { statusCode: 400 });
    }
    const mimeType = imageType(file);
    if (await this.db.orderHandoverPhoto.count({ where: { tenantId, orderId } }) >= MAX_PHOTOS) {
      throw Object.assign(new Error('Do przekazania można dodać maksymalnie 10 zdjęć'), { statusCode: 409 });
    }
    const checksumSha256 = checksum(file.buffer);
    if (await this.db.orderHandoverPhoto.findFirst({ where: { tenantId, orderId, checksumSha256 }, select: { id: true } })) {
      throw Object.assign(new Error('To zdjęcie jest już przypisane do przekazania'), { statusCode: 409 });
    }
    const fileName = path.basename(file.originalname.replace(/\\/g, '/')).slice(0, 500) || 'zdjecie';
    const storageKey = `${tenantId}/handover/${orderId}/${randomUUID()}.${mimeType === 'image/png' ? 'png' : 'jpg'}`;
    await this.objectStorage.uploadFile(storageKey, file.buffer, mimeType);
    try {
      return await this.db.orderHandoverPhoto.create({
        data: { tenantId, orderId, boxId: boxId || null, storageKey, fileName, mimeType, fileSize: file.buffer.length, checksumSha256, uploadedById: userId },
        select: { id: true, boxId: true, fileName: true, mimeType: true, fileSize: true, checksumSha256: true, uploadedAt: true },
      });
    } catch (error) {
      await this.objectStorage.deleteFile(storageKey).catch(() => undefined);
      if ((error as { code?: string }).code === 'P2002') {
        throw Object.assign(new Error('To zdjęcie jest już przypisane do przekazania'), { statusCode: 409 });
      }
      throw error;
    }
  }

  async list(tenantId: string, orderId: string) {
    await this.assertProof(tenantId, orderId);
    return this.db.orderHandoverPhoto.findMany({
      where: { tenantId, orderId },
      orderBy: [{ uploadedAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true, boxId: true, box: { select: { boxNumber: true } }, fileName: true, mimeType: true,
        fileSize: true, checksumSha256: true, uploadedAt: true,
        uploadedBy: { select: { firstName: true, lastName: true } },
      },
    });
  }

  async download(tenantId: string, orderId: string, photoId: string) {
    await this.assertProof(tenantId, orderId);
    const photo = await this.db.orderHandoverPhoto.findFirst({
      where: { id: photoId, tenantId, orderId },
      select: { storageKey: true, mimeType: true, checksumSha256: true },
    });
    if (!photo) throw Object.assign(new Error('Zdjęcie nie zostało znalezione'), { statusCode: 404 });
    const buffer = await this.objectStorage.downloadFile(photo.storageKey);
    if (checksum(buffer) !== photo.checksumSha256) throw new Error('Suma kontrolna zdjęcia nie zgadza się z zapisem');
    return { buffer, mimeType: photo.mimeType };
  }
}

export const orderHandoverPhotoService = new OrderHandoverPhotoService();
