import { prisma } from '../../config/database';

export class LocationService {
  async getTree(tenantId: string | null) {
    const locations = await prisma.location.findMany({
      where: { isActive: true, ...(tenantId ? { OR: [{ tenantId }, { tenantId: null }] } : {}) },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });

    // Build tree from flat list
    const map = new Map<string, any>();
    const roots: any[] = [];

    for (const loc of locations) {
      map.set(loc.id, { ...loc, children: [] });
    }

    for (const loc of locations) {
      const node = map.get(loc.id)!;
      if (loc.parentId && map.has(loc.parentId)) {
        map.get(loc.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    // Aggregate counts from children to parents
    function aggregateCounts(node: any): number {
      let total = node.currentCount || 0;
      if (node.children) {
        for (const child of node.children) {
          total += aggregateCounts(child);
        }
      }
      node.aggregatedCount = total;
      return total;
    }
    roots.forEach(aggregateCounts);

    return roots;
  }

  async getById(id: string, tenantId: string | null) {
    const location = await prisma.location.findFirst({
      where: { id, ...(tenantId ? { OR: [{ tenantId }, { tenantId: null }] } : {}) },
      include: { children: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
    });
    if (!location) throw Object.assign(new Error('Lokalizacja nie znaleziona'), { statusCode: 404 });
    return location;
  }

  async create(data: any, tenantId: string | null) {
    let fullPath = data.name;
    if (data.parentId) {
      const parent = await prisma.location.findFirst({
        where: { id: data.parentId, ...(tenantId ? { OR: [{ tenantId }, { tenantId: null }] } : {}) },
      });
      if (parent) fullPath = `${parent.fullPath} > ${data.name}`;
    }

    return prisma.location.create({
      data: {
        parentId: data.parentId,
        tenantId,
        type: data.type,
        code: data.code,
        name: data.name,
        description: data.description,
        capacity: data.capacity,
        fullPath,
      },
    });
  }

  async update(id: string, tenantId: string | null, data: any) {
    // Verify the location belongs to this tenant
    await this.getById(id, tenantId);
    return prisma.location.update({
      where: { id },
      data: {
        name: data.name,
        description: data.description,
        capacity: data.capacity,
        isActive: data.isActive,
      },
    });
  }

  async getAvailableSlots(tenantId: string | null) {
    return prisma.location.findMany({
      where: {
        isActive: true,
        type: { in: ['shelf', 'slot'] },
        ...(tenantId ? { OR: [{ tenantId }, { tenantId: null }] } : {}),
      },
      orderBy: { fullPath: 'asc' },
    });
  }

  async getBoxes(locationId: string, tenantId: string) {
    return prisma.box.findMany({
      where: { locationId, tenantId },
      orderBy: { boxNumber: 'asc' },
      select: { id: true, boxNumber: true, title: true, status: true, qrCode: true },
    });
  }
}

export const locationService = new LocationService();
