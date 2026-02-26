import { prisma } from '../../config/database';
import { Prisma, HRPartCode, EmploymentStatus } from '@prisma/client';
import { encryptAES256, decryptAES256, hmacSha256 } from '../../utils/crypto';

const HR_PARTS: HRPartCode[] = ['A', 'B', 'C', 'D', 'E'];

export class HRService {
  async list(tenantId: string, filters: any, skip: number, take: number) {
    const where: Prisma.HRFolderWhereInput = { tenantId };

    if (filters.employmentStatus) where.employmentStatus = filters.employmentStatus as EmploymentStatus;
    if (filters.department) where.department = { contains: filters.department, mode: 'insensitive' };
    if (filters.disposalStatus) where.disposalStatus = filters.disposalStatus as any;
    if (filters.storageForm) where.storageForm = filters.storageForm as any;
    if (filters.search) {
      where.OR = [
        { employeeFirstName: { contains: filters.search, mode: 'insensitive' } },
        { employeeLastName: { contains: filters.search, mode: 'insensitive' } },
        { department: { contains: filters.search, mode: 'insensitive' } },
        { position: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      prisma.hRFolder.findMany({
        where,
        skip,
        take,
        orderBy: { employeeLastName: 'asc' },
        select: {
          id: true,
          tenantId: true,
          employeeFirstName: true,
          employeeLastName: true,
          // NOTE: PESEL is NOT returned in list (privacy)
          employeeIdNumber: true,
          employmentStart: true,
          employmentEnd: true,
          employmentStatus: true,
          department: true,
          position: true,
          retentionPeriod: true,
          retentionEndDate: true,
          disposalStatus: true,
          storageForm: true,
          litigationHold: true,
          createdAt: true,
          updatedAt: true,
          box: { select: { id: true, boxNumber: true, title: true } },
          _count: { select: { parts: true, orderItems: true } },
        },
      }),
      prisma.hRFolder.count({ where }),
    ]);

    return { data, total };
  }

  async getById(id: string, tenantId: string, includePesel: boolean = false) {
    const folder = await prisma.hRFolder.findFirst({
      where: { id, tenantId },
      include: {
        box: { select: { id: true, boxNumber: true, title: true, locationId: true, location: { select: { fullPath: true } } } },
        parts: {
          orderBy: { partCode: 'asc' },
          include: {
            hrDocuments: {
              orderBy: { orderNumber: 'asc' },
              include: {
                attachment: { select: { id: true, fileName: true, fileSize: true, mimeType: true } },
              },
            },
          },
        },
      },
    });

    if (!folder) throw Object.assign(new Error('Akta osobowe nie znalezione'), { statusCode: 404 });

    // Decrypt PESEL only if user has permission
    const result: any = { ...folder };
    if (includePesel) {
      try {
        result.employeePeselDecrypted = decryptAES256(folder.employeePesel);
      } catch {
        result.employeePeselDecrypted = null;
      }
    }
    // Always mask the encrypted value
    result.employeePesel = '***********';

    return result;
  }

  async create(data: any, tenantId: string) {
    // Encrypt PESEL
    const encryptedPesel = encryptAES256(data.employeePesel);
    const peselHmac = hmacSha256(data.employeePesel);

    // Check for duplicate PESEL in this tenant
    const existing = await prisma.hRFolder.findFirst({
      where: { tenantId, employeePeselHmac: peselHmac },
    });
    if (existing) {
      throw Object.assign(
        new Error('Akta osobowe dla tego numeru PESEL już istnieją'),
        { statusCode: 409 }
      );
    }

    // Calculate retention dates
    const retentionBaseDate = data.employmentEnd ? new Date(data.employmentEnd) : null;
    let retentionEndDate: Date | null = null;
    if (retentionBaseDate) {
      const years = data.retentionPeriod === 'fifty_years' ? 50 : 10;
      retentionEndDate = new Date(retentionBaseDate);
      retentionEndDate.setFullYear(retentionEndDate.getFullYear() + years);
    }

    const folder = await prisma.hRFolder.create({
      data: {
        tenantId,
        employeeFirstName: data.employeeFirstName,
        employeeLastName: data.employeeLastName,
        employeePesel: encryptedPesel,
        employeePeselHmac: peselHmac,
        employeeIdNumber: data.employeeIdNumber,
        employmentStart: data.employmentStart ? new Date(data.employmentStart) : undefined,
        employmentEnd: data.employmentEnd ? new Date(data.employmentEnd) : undefined,
        employmentStatus: data.employmentStatus || 'active',
        department: data.department,
        position: data.position,
        retentionPeriod: data.retentionPeriod || 'ten_years',
        retentionBaseDate,
        retentionEndDate,
        storageForm: data.storageForm || 'paper',
        boxId: data.boxId,
        notes: data.notes,
        // Auto-create all 5 parts (A-E)
        parts: {
          create: HR_PARTS.map(code => ({
            partCode: code,
            description: getPartDescription(code),
          })),
        },
      },
      include: {
        parts: { orderBy: { partCode: 'asc' } },
        box: { select: { id: true, boxNumber: true } },
      },
    });

    // Mask PESEL in response
    const result: any = { ...folder };
    result.employeePesel = '***********';
    return result;
  }

  async update(id: string, tenantId: string, data: any) {
    await this.getById(id, tenantId);

    const updateData: any = {};
    if (data.employeeFirstName) updateData.employeeFirstName = data.employeeFirstName;
    if (data.employeeLastName) updateData.employeeLastName = data.employeeLastName;
    if (data.employeeIdNumber !== undefined) updateData.employeeIdNumber = data.employeeIdNumber;
    if (data.employmentStart) updateData.employmentStart = new Date(data.employmentStart);
    if (data.employmentEnd) updateData.employmentEnd = new Date(data.employmentEnd);
    if (data.employmentStatus) updateData.employmentStatus = data.employmentStatus;
    if (data.department !== undefined) updateData.department = data.department;
    if (data.position !== undefined) updateData.position = data.position;
    if (data.storageForm) updateData.storageForm = data.storageForm;
    if (data.boxId !== undefined) updateData.boxId = data.boxId;
    if (data.notes !== undefined) updateData.notes = data.notes;

    // Recalculate retention if employment end date changed
    if (data.employmentEnd) {
      const folder = await prisma.hRFolder.findUnique({ where: { id } });
      if (folder) {
        const years = folder.retentionPeriod === 'fifty_years' ? 50 : 10;
        updateData.retentionBaseDate = new Date(data.employmentEnd);
        updateData.retentionEndDate = new Date(data.employmentEnd);
        updateData.retentionEndDate.setFullYear(updateData.retentionEndDate.getFullYear() + years);
      }
    }

    const updated = await prisma.hRFolder.update({
      where: { id },
      data: updateData,
      include: {
        parts: { orderBy: { partCode: 'asc' } },
        box: { select: { id: true, boxNumber: true } },
      },
    });

    const result: any = { ...updated };
    result.employeePesel = '***********';
    return result;
  }

  async searchByPesel(tenantId: string, pesel: string) {
    const peselHmac = hmacSha256(pesel);
    const folders = await prisma.hRFolder.findMany({
      where: { tenantId, employeePeselHmac: peselHmac },
      select: {
        id: true,
        employeeFirstName: true,
        employeeLastName: true,
        employmentStatus: true,
        department: true,
        position: true,
        createdAt: true,
      },
    });
    return folders;
  }

  // HR Document management within parts
  async addDocument(hrFolderPartId: string, tenantId: string, data: any) {
    const part = await prisma.hRFolderPart.findUnique({
      where: { id: hrFolderPartId },
      include: { hrFolder: { select: { tenantId: true } } },
    });
    if (!part || part.hrFolder.tenantId !== tenantId) {
      throw Object.assign(new Error('Część akt nie znaleziona'), { statusCode: 404 });
    }

    // Get next order number
    const lastDoc = await prisma.hRDocument.findFirst({
      where: { hrFolderPartId },
      orderBy: { orderNumber: 'desc' },
    });
    const orderNumber = lastDoc ? lastDoc.orderNumber + 1 : 1;

    const doc = await prisma.hRDocument.create({
      data: {
        hrFolderPartId,
        tenantId,
        title: data.title,
        docType: data.docType,
        docDate: data.docDate ? new Date(data.docDate) : undefined,
        orderNumber,
        pageCount: data.pageCount,
        notes: data.notes,
        attachmentId: data.attachmentId,
      },
      include: {
        attachment: { select: { id: true, fileName: true, fileSize: true, mimeType: true } },
      },
    });

    // Update document count
    await prisma.hRFolderPart.update({
      where: { id: hrFolderPartId },
      data: { documentCount: { increment: 1 } },
    });

    return doc;
  }

  async removeDocument(docId: string, tenantId: string) {
    const doc = await prisma.hRDocument.findFirst({
      where: { id: docId, tenantId },
    });
    if (!doc) throw Object.assign(new Error('Dokument nie znaleziony'), { statusCode: 404 });

    await prisma.hRDocument.delete({ where: { id: docId } });

    // Decrement counter
    await prisma.hRFolderPart.update({
      where: { id: doc.hrFolderPartId },
      data: { documentCount: { decrement: 1 } },
    });

    return { deleted: true };
  }

  async setLitigationHold(id: string, tenantId: string, hold: boolean, until?: string, notes?: string) {
    await this.getById(id, tenantId);
    return prisma.hRFolder.update({
      where: { id },
      data: {
        litigationHold: hold,
        litigationHoldUntil: until ? new Date(until) : null,
        litigationNotes: notes || null,
      },
    });
  }

  async getRetentionExpiring(tenantId: string, daysAhead: number = 90) {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + daysAhead);

    return prisma.hRFolder.findMany({
      where: {
        tenantId,
        retentionEndDate: { lte: futureDate, gte: new Date() },
        disposalStatus: 'active',
        litigationHold: false,
      },
      orderBy: { retentionEndDate: 'asc' },
      select: {
        id: true,
        employeeFirstName: true,
        employeeLastName: true,
        employmentStatus: true,
        retentionPeriod: true,
        retentionEndDate: true,
        department: true,
      },
    });
  }
}

function getPartDescription(code: HRPartCode): string {
  const descriptions: Record<HRPartCode, string> = {
    A: 'Dokumenty związane z ubieganiem się o zatrudnienie',
    B: 'Dokumenty dotyczące nawiązania i przebiegu stosunku pracy',
    C: 'Dokumenty związane z ustaniem zatrudnienia',
    D: 'Dokumenty dotyczące ponoszenia odpowiedzialności porządkowej lub dyscyplinarnej',
    E: 'Dokumenty związane z kontrolą trzeźwości lub obecności środków psychoaktywnych',
  };
  return descriptions[code];
}

export const hrService = new HRService();
