import { prisma } from '../../config/database';
import { uploadFile, downloadFile, deleteFile } from '../../config/minio';
import crypto from 'crypto';
import path from 'path';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { createPeselRedactedCopy } from './pdf-redaction.service';

const uploadRelationsSchema = z.object({
  documentId: z.preprocess(value => value === '' ? undefined : value, z.string().uuid().optional()),
  folderId: z.preprocess(value => value === '' ? undefined : value, z.string().uuid().optional()),
  boxId: z.preprocess(value => value === '' ? undefined : value, z.string().uuid().optional()),
});

export class AttachmentService {
  private accessWhere(tenantId: string, department?: string, canViewHr = false): Prisma.AttachmentWhereInput {
    const departmentFilter = { equals: department, mode: 'insensitive' as const };
    return {
      tenantId,
      ...(!canViewHr ? { hrDocuments: { none: {} } } : {}),
      ...(department ? {
        OR: [
          { documentId: { not: null }, document: { folderId: { not: null }, folder: { box: { department: departmentFilter } } } },
          { documentId: { not: null }, document: { folderId: null, box: { department: departmentFilter } } },
          { documentId: null, folderId: { not: null }, folder: { box: { department: departmentFilter } } },
          { documentId: null, folderId: null, box: { department: departmentFilter } },
        ],
      } : {}),
    };
  }

  async upload(
    file: Express.Multer.File,
    tenantId: string,
    userId: string,
    relations: { documentId?: string; folderId?: string; boxId?: string },
    department?: string,
  ) {
    const target = await this.validateUploadRelations(tenantId, relations, department);
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
        documentId: target.documentId,
        folderId: target.folderId,
        boxId: target.boxId,
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

  private async validateUploadRelations(
    tenantId: string,
    relations: { documentId?: string; folderId?: string; boxId?: string },
    department?: string,
  ) {
    const parsed = uploadRelationsSchema.safeParse(relations);
    if (!parsed.success) throw Object.assign(new Error('Nieprawidłowy identyfikator dokumentu, teczki lub kartonu'), { statusCode: 400 });
    const target = parsed.data;
    if (!target.documentId && !target.folderId && !target.boxId) {
      throw Object.assign(new Error('Wskaż dokument, teczkę lub karton'), { statusCode: 400 });
    }

    const document = target.documentId ? await prisma.document.findFirst({
      where: { id: target.documentId, tenantId },
      select: { folderId: true, boxId: true },
    }) : null;
    if (target.documentId && !document) throw Object.assign(new Error('Dokument nie znaleziony'), { statusCode: 404 });
    if (document && target.folderId && target.folderId !== document.folderId) {
      throw Object.assign(new Error('Dokument nie należy do wskazanej teczki'), { statusCode: 400 });
    }

    const folderId = document?.folderId || target.folderId;
    const folder = folderId ? await prisma.folder.findFirst({
      where: { id: folderId, tenantId },
      select: { boxId: true },
    }) : null;
    if (folderId && !folder) throw Object.assign(new Error('Teczka nie znaleziona'), { statusCode: 404 });
    if (document?.folderId && document.boxId && document.boxId !== folder?.boxId) {
      throw Object.assign(new Error('Dokument ma sprzeczne przypisanie do kartonu'), { statusCode: 409 });
    }

    const linkedBoxId = folder ? folder.boxId : document?.boxId;
    if (target.boxId && (document || folder) && target.boxId !== linkedBoxId) {
      throw Object.assign(new Error('Karton nie odpowiada wskazanemu dokumentowi lub teczce'), { statusCode: 400 });
    }
    const boxId = target.boxId || linkedBoxId;
    const box = boxId ? await prisma.box.findFirst({
      where: { id: boxId, tenantId, deletedAt: null },
      select: { department: true },
    }) : null;
    if (boxId && !box) throw Object.assign(new Error('Karton nie znaleziony'), { statusCode: 404 });
    if (department && box?.department?.toLocaleLowerCase('pl') !== department.toLocaleLowerCase('pl')) {
      throw Object.assign(new Error('Brak dostępu do działu kartonu'), { statusCode: 403 });
    }
    return target;
  }

  async getById(id: string, tenantId: string, department?: string, canViewHr = false) {
    const attachment = await prisma.attachment.findFirst({
      where: { id, ...this.accessWhere(tenantId, department, canViewHr) },
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

  async download(id: string, tenantId: string, department?: string, canViewHr = false) {
    const attachment = await this.getById(id, tenantId, department, canViewHr);
    const buffer = await downloadFile(attachment.filePath);
    return { attachment, buffer };
  }

  async downloadPeselRedactedCopy(id: string, tenantId: string, department?: string, canViewHr = false) {
    const { attachment, buffer } = await this.download(id, tenantId, department, canViewHr);
    if (attachment.mimeType !== 'application/pdf' || buffer.subarray(0, 5).toString() !== '%PDF-') {
      throw Object.assign(new Error('Kopia z zakrytym PESEL jest dostępna tylko dla plików PDF'), { statusCode: 400 });
    }
    return { attachment, ...await createPeselRedactedCopy(buffer) };
  }

  async list(tenantId: string, filters: any, skip: number, take: number, department?: string, canViewHr = false) {
    const where: Prisma.AttachmentWhereInput = this.accessWhere(tenantId, department, canViewHr);
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
    if (attachment.documentId || attachment.folderId || attachment.boxId
      || await prisma.hRDocument.count({ where: { attachmentId: id, tenantId } })) {
      throw Object.assign(new Error('Załącznik przypisany do dokumentacji wymaga procedury brakowania'), { statusCode: 409 });
    }

    // Delete from MinIO
    await deleteFile(attachment.filePath);

    // Delete from DB
    await prisma.attachment.delete({ where: { id } });

    return { deleted: true };
  }
}

export const attachmentService = new AttachmentService();
