import { prisma } from '../../config/database';
import { parseQrData } from '@archivecore/shared';
import { Prisma } from '@prisma/client';

export function expectedInventoryBoxes<T extends { id: string; status: string }>(boxes: T[], loanedBoxIds: Set<string>) {
  return boxes.filter((box) => !loanedBoxIds.has(box.id) && !['disposed', 'lost'].includes(box.status));
}

export class InventoryService {
  async snapshot(locationId: string, tenantId: string) {
    const location = await prisma.location.findFirst({
      where: { id: locationId, isActive: true, OR: [{ tenantId }, { tenantId: null }] },
      select: { id: true, fullPath: true, type: true },
    });
    if (!location) throw Object.assign(new Error('Lokalizacja nie znaleziona'), { statusCode: 404 });
    if (!['shelf', 'level', 'slot'].includes(location.type)) {
      throw Object.assign(new Error('Wybierz półkę, poziom lub pozycję odkładczą'), { statusCode: 400 });
    }

    const boxes = await prisma.box.findMany({
      where: { tenantId, locationId, deletedAt: null },
      select: { id: true, boxNumber: true, title: true, qrCode: true, status: true, locationId: true },
      orderBy: { boxNumber: 'asc' },
    });
    const directLoans = boxes.length ? await prisma.orderItem.findMany({
      where: {
        boxId: { in: boxes.map((box) => box.id) },
        itemStatus: 'delivered',
        order: { tenantId, orderType: 'checkout', status: { in: ['delivered', 'completed'] } },
      },
      select: { boxId: true },
    }) : [];
    const loanedBoxIds = new Set(directLoans.map((item) => item.boxId).filter((id): id is string => Boolean(id)));
    const expected = expectedInventoryBoxes(boxes, loanedBoxIds);
    return { location, expected, excludedCount: boxes.length - expected.length, capturedAt: new Date().toISOString() };
  }

  async resolveBox(qrCode: string, tenantId: string) {
    const parsed = parseQrData(qrCode);
    if (!parsed?.isValid) throw Object.assign(new Error('Nieprawidłowy kod QR kartonu'), { statusCode: 400 });
    const box = await prisma.box.findFirst({
      where: { tenantId, qrCode, deletedAt: null },
      select: {
        id: true, boxNumber: true, title: true, qrCode: true, status: true, locationId: true,
        location: { select: { fullPath: true } },
      },
    });
    if (!box) throw Object.assign(new Error('Nie znaleziono kartonu w aktywnej firmie'), { statusCode: 404 });
    return box;
  }

  async listSessions(tenantId: string, page: number) {
    const take = 20;
    const where = { tenantId };
    const [sessions, total] = await Promise.all([
      prisma.inventorySession.findMany({
        where,
        select: { id: true, locationPath: true, status: true, startedAt: true, finishedAt: true },
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * take,
        take,
      }),
      prisma.inventorySession.count({ where }),
    ]);
    return { sessions, page, totalPages: Math.ceil(total / take), total };
  }

  async getSession(id: string, tenantId: string) {
    const session = await prisma.inventorySession.findFirst({
      where: { id, tenantId },
      include: { scans: { where: { voidedAt: null }, orderBy: [{ scannedAt: 'asc' }, { id: 'asc' }] } },
    });
    if (!session) throw Object.assign(new Error('Kontrola półki nie znaleziona'), { statusCode: 404 });
    return {
      id: session.id,
      status: session.status,
      finishedAt: session.finishedAt,
      snapshot: {
        location: { id: session.locationId, fullPath: session.locationPath },
        expected: session.expected,
        excludedCount: session.excludedCount,
        capturedAt: session.startedAt,
      },
      scanned: session.scans.map((scan) => ({
        ...(scan.boxData as Record<string, unknown>),
        scanId: scan.id,
      })),
    };
  }

  async startSession(locationId: string, tenantId: string, userId: string) {
    const snapshot = await this.snapshot(locationId, tenantId);
    const session = await prisma.inventorySession.create({
      data: {
        tenantId,
        locationId,
        locationPath: snapshot.location.fullPath,
        expected: snapshot.expected as Prisma.InputJsonValue,
        excludedCount: snapshot.excludedCount,
        startedById: userId,
      },
    });
    return this.getSession(session.id, tenantId);
  }

  private async lockSession(tx: Prisma.TransactionClient, id: string, tenantId: string) {
    const rows = await tx.$queryRaw<{ status: string }[]>(Prisma.sql`
      SELECT "status" FROM "inventory_sessions"
      WHERE "id" = ${id}::uuid AND "tenantId" = ${tenantId}::uuid
      FOR UPDATE
    `);
    if (rows.length !== 1) throw Object.assign(new Error('Kontrola półki nie znaleziona'), { statusCode: 404 });
    if (rows[0].status !== 'in_progress') {
      throw Object.assign(new Error('Ta kontrola jest już zakończona'), { statusCode: 409 });
    }
  }

  async scanBox(id: string, tenantId: string, qrCode: string, userId: string) {
    if (!parseQrData(qrCode)?.isValid) {
      throw Object.assign(new Error('Nieprawidłowy kod QR kartonu'), { statusCode: 400 });
    }
    await prisma.$transaction(async (tx) => {
      await this.lockSession(tx, id, tenantId);
      const box = await tx.box.findFirst({
        where: { tenantId, qrCode, deletedAt: null },
        select: {
          id: true, boxNumber: true, title: true, qrCode: true, status: true, locationId: true,
          location: { select: { fullPath: true } },
        },
      });
      if (!box) throw Object.assign(new Error('Nie znaleziono kartonu w aktywnej firmie'), { statusCode: 404 });
      const existing = await tx.inventoryScan.findFirst({
        where: { sessionId: id, boxId: box.id, voidedAt: null },
        select: { id: true },
      });
      if (existing) throw Object.assign(new Error('Ten karton został już zeskanowany'), { statusCode: 409 });
      await tx.inventoryScan.create({
        data: { sessionId: id, boxId: box.id, boxData: box, scannedById: userId },
      });
    });
    return this.getSession(id, tenantId);
  }

  async undoScan(id: string, scanId: string, tenantId: string, userId: string) {
    await prisma.$transaction(async (tx) => {
      await this.lockSession(tx, id, tenantId);
      const latest = await tx.inventoryScan.findFirst({
        where: { sessionId: id, voidedAt: null },
        orderBy: [{ scannedAt: 'desc' }, { id: 'desc' }],
        select: { id: true },
      });
      if (latest?.id !== scanId) {
        throw Object.assign(new Error('Lista skanów zmieniła się. Odśwież kontrolę i spróbuj ponownie.'), { statusCode: 409 });
      }
      const result = await tx.inventoryScan.updateMany({
        where: { id: scanId, sessionId: id, voidedAt: null },
        data: { voidedAt: new Date(), voidedById: userId },
      });
      if (result.count !== 1) throw Object.assign(new Error('Skan nie znaleziony'), { statusCode: 404 });
    });
    return this.getSession(id, tenantId);
  }

  async finishSession(id: string, tenantId: string, userId: string) {
    await prisma.$transaction(async (tx) => {
      await this.lockSession(tx, id, tenantId);
      await tx.inventorySession.update({
        where: { id },
        data: { status: 'completed', finishedAt: new Date(), finishedById: userId },
      });
    });
    return this.getSession(id, tenantId);
  }
}

export const inventoryService = new InventoryService();
