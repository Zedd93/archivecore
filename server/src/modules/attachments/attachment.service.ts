import { prisma } from '../../config/database';
import { uploadFile, getPresignedUrl, deleteFile } from '../../config/minio';
import crypto from 'crypto';
import path from 'path';

export class AttachmentService {
  async upload(
    file: Express.Multer.File,
    tenantId: string,
    userId: string,
    relations: { documentId?: string; folderId?: string; boxId?: string }
  ) {
    // Generate file path: tenantId/year/month/uuid.ext
    const ext = path.extname(file.originalname);
    const now = new Date();
    const filePath = `${tenantId}/${now.getFullYear()}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${crypto.randomUUID()}${ext}`;

    // Calculate checksum
    const checksumSha256 = crypto.createHash('sha256').update(file.buffer).digest('hex');

    // Upload to MinIO
    await uploadFile(filePath, file.buffer, file.mimetype);

    // Save metadata
    const attachment = await prisma.attachment.create({
      data: {
        tenantId,
        documentId: relations.documentId,
        folderId: relations.folderId,
        boxId: relations.boxId,
        fileName: file.originalname,
        filePath,
        fileSize: BigInt(file.size),
        mimeType: file.mimetype,
        checksumSha256,
        uploadedBy: userId,
      },
    });

    return {
      ...attachment,
      fileSize: attachment.fileSize.toString(),
    };
  }

  async getById(id: string, tenantId: string) {
    const attachment = await prisma.attachment.findFirst({
      where: { id, tenantId },
      include: {
        uploader: { select: { id: true, firstName: true, lastName: true } },
        document: { select: { id: true, title: true } },
        folder: { select: { id: true, folderNumber: true, title: true } },
        box: { select: { id: true, boxNumber: true, title: true } },
      },
    });
    if (!attachment) throw Object.assign(new Error('Załącznik nie znaleziony'), { statusCode: 404 });
    return attachment;
  }

  async getDownloadUrl(id: string, tenantId: string): Promise<string> {
    const attachment = await this.getById(id, tenantId);
    return getPresignedUrl(attachment.filePath, 900); // 15 min
  }

  async list(tenantId: string, filters: any, skip: number, take: number) {
    const where: any = { tenantId };
    if (filters.boxId) where.boxId = filters.boxId;
    if (filters.folderId) where.folderId = filters.folderId;
    if (filters.documentId) where.documentId = filters.documentId;

    const [data, total] = await Promise.all([
      prisma.attachment.findMany({
        where,
        skip,
        take,
        orderBy: { uploadedAt: 'desc' },
        select: {
          id: true,
          fileName: true,
          fileSize: true,
          mimeType: true,
          checksumSha256: true,
          version: true,
          uploadedAt: true,
          uploadedBy: true,
          uploader: { select: { firstName: true, lastName: true } },
        },
      }),
      prisma.attachment.count({ where }),
    ]);

    // Convert BigInt to string for JSON serialization
    const serialized = data.map(a => ({ ...a, fileSize: a.fileSize.toString() }));
    return { data: serialized, total };
  }

  async delete(id: string, tenantId: string) {
    const attachment = await this.getById(id, tenantId);

    // Delete from MinIO
    await deleteFile(attachment.filePath);

    // Delete from DB
    await prisma.attachment.delete({ where: { id } });

    return { deleted: true };
  }
}

export const attachmentService = new AttachmentService();
