import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { prisma } from '../../config/database';
import { deleteFile, downloadFile, uploadFile } from '../../config/minio';
import { scanItemDepartmentWhere } from './scan-access';

const MAX_SCAN_BYTES = 25 * 1024 * 1024;
const storage = { uploadFile, downloadFile, deleteFile };

function fail(message: string, statusCode: number): never {
  throw Object.assign(new Error(message), { statusCode });
}

function sha256(buffer: Buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export class OrderScanService {
  constructor(private readonly db = prisma, private readonly objectStorage = storage) {}

  private async item(orderId: string, itemId: string, tenantId: string, department?: string) {
    const item = await this.db.orderItem.findFirst({
      where: { id: itemId, orderId, order: { tenantId, orderType: 'scan', ...(department ? { items: { every: scanItemDepartmentWhere(department) } } : {}) } },
      select: {
        id: true, folderId: true, order: { select: { status: true } }, scanFile: { select: { id: true, storageKey: true, checksumSha256: true, fileName: true, pageCount: true, fileSize: true, uploadedAt: true } },
        folder: { select: { box: { select: { department: true } } } },
        document: { select: { box: { select: { department: true } }, folder: { select: { box: { select: { department: true } } } } } },
        transferListItem: { select: { folderId: true, box: { select: { department: true } }, folder: { select: { box: { select: { department: true } } } } } },
      },
    });
    if (!item) fail('Pozycja zlecenia skanu nie została znaleziona', 404);
    if (department) {
      const departments = [item.folder?.box?.department, item.document?.box?.department,
        item.document?.folder?.box?.department, item.transferListItem?.box?.department,
        item.transferListItem?.folder?.box?.department];
      if (!departments.some((value) => value?.toLowerCase() === department.toLowerCase())) {
        fail('Nie masz dostępu do skanu tej pozycji', 404);
      }
    }
    return item;
  }

  async upload(orderId: string, itemId: string, tenantId: string, userId: string, file: Express.Multer.File, department?: string) {
    const item = await this.item(orderId, itemId, tenantId, department);
    if (item.order.status !== 'in_progress') fail('Skan można dodać tylko podczas realizacji zlecenia', 409);
    if (item.scanFile) fail('Skan tej pozycji został już dodany', 409);
    if (file.mimetype !== 'application/pdf' || file.buffer.length < 8 || file.buffer.length > MAX_SCAN_BYTES ||
      !file.buffer.subarray(0, 5).equals(Buffer.from('%PDF-')) ||
      !file.buffer.subarray(-1024).includes(Buffer.from('%%EOF'))) {
      fail('Dołącz poprawny plik PDF o rozmiarze do 25 MB', 400);
    }
    let pageCount: number;
    try {
      pageCount = (await PDFDocument.load(file.buffer)).getPageCount();
    } catch {
      fail('Nie można odczytać stron PDF. Plik może być uszkodzony lub zabezpieczony hasłem', 400);
    }
    if (pageCount < 1 || pageCount > 500) fail('PDF musi zawierać od 1 do 500 stron', 400);
    const storageKey = `${tenantId}/order-scans/${orderId}/${itemId}/${randomUUID()}.pdf`;
    const fileName = path.basename(file.originalname.replace(/\\/g, '/')).slice(0, 500) || 'skan.pdf';
    const checksumSha256 = sha256(file.buffer);
    await this.objectStorage.uploadFile(storageKey, file.buffer, 'application/pdf');
    try {
      return await this.db.orderScanFile.create({
        data: { tenantId, orderItemId: itemId, storageKey, fileName, fileSize: file.buffer.length, checksumSha256, pageCount, uploadedById: userId },
        select: { id: true, fileName: true, fileSize: true, checksumSha256: true, pageCount: true, uploadedAt: true },
      });
    } catch (error) {
      await this.objectStorage.deleteFile(storageKey).catch(() => undefined);
      throw error;
    }
  }

  async attachExisting(orderId: string, itemId: string, tenantId: string, userId: string, attachmentId: string, department?: string) {
    const item = await this.item(orderId, itemId, tenantId, department);
    if (item.order.status !== 'in_progress') fail('Skan można dodać tylko podczas realizacji zlecenia', 409);
    if (item.scanFile) fail('Skan tej pozycji został już dodany', 409);
    const folderId = item.document ? null : item.folderId || item.transferListItem?.folderId;
    if (!folderId) fail('Ta pozycja nie wskazuje teczki, z której można wybrać istniejący skan', 400);

    const attachment = await this.db.attachment.findFirst({
      where: { id: attachmentId, tenantId, folderId, mimeType: 'application/pdf' },
      select: { filePath: true, fileName: true, fileSize: true, checksumSha256: true },
    });
    if (!attachment) fail('Nie znaleziono skanu PDF przypisanego do tej teczki', 404);
    if (attachment.fileSize > BigInt(MAX_SCAN_BYTES)) fail('Wybrany PDF przekracza 25 MB', 400);
    const buffer = await this.objectStorage.downloadFile(attachment.filePath);
    if (sha256(buffer) !== attachment.checksumSha256) fail('Suma kontrolna istniejącego skanu jest nieprawidłowa', 409);

    // Keep an independent copy: removing a folder attachment must not break a delivered order.
    return this.upload(orderId, itemId, tenantId, userId, {
      buffer, mimetype: 'application/pdf', originalname: attachment.fileName,
    } as Express.Multer.File, department);
  }

  async download(orderId: string, itemId: string, tenantId: string, department?: string) {
    const item = await this.item(orderId, itemId, tenantId, department);
    if (!['delivered', 'completed'].includes(item.order.status)) fail('Skan nie został jeszcze udostępniony', 409);
    if (!item.scanFile) fail('Skan nie został znaleziony', 404);
    const buffer = await this.objectStorage.downloadFile(item.scanFile.storageKey);
    if (sha256(buffer) !== item.scanFile.checksumSha256) throw new Error('Suma kontrolna skanu nie zgadza się z zapisem');
    return { id: item.scanFile.id, buffer, fileName: item.scanFile.fileName };
  }
}

export const orderScanService = new OrderScanService();
