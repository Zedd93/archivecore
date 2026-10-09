import { prisma } from '../../config/database';
import { parseQrData } from '@archivecore/shared';

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
}

export const inventoryService = new InventoryService();
