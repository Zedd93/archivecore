import { prisma } from '../../config/database';

export class LocationService {
  private compactUpdateData(data: Record<string, unknown>) {
    return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
  }

  private buildLocationWhere(id: string, tenantId: string | null) {
    return {
      id,
      ...(tenantId ? { OR: [{ tenantId }, { tenantId: null }] } : {}),
    };
  }

  private async getDescendantIds(id: string) {
    const descendants = await prisma.location.findMany({
      where: { parentId: id },
      select: { id: true },
    });
    const ids = descendants.map((location) => location.id);
    for (const child of descendants) {
      ids.push(...await this.getDescendantIds(child.id));
    }
    return ids;
  }

  private async refreshChildPaths(parentId: string, parentPath: string, tx: any) {
    const children = await tx.location.findMany({ where: { parentId } });
    for (const child of children) {
      const fullPath = `${parentPath} > ${child.name}`;
      await tx.location.update({
        where: { id: child.id },
        data: { fullPath },
      });
      await this.refreshChildPaths(child.id, fullPath, tx);
    }
  }

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
      where: this.buildLocationWhere(id, tenantId),
      include: { children: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
    });
    if (!location) throw Object.assign(new Error('Lokalizacja nie znaleziona'), { statusCode: 404 });
    return location;
  }

  async create(data: any, tenantId: string | null) {
    let fullPath = data.name;
    let locationTenantId = tenantId;

    if (data.parentId) {
      const parent = await prisma.location.findFirst({
        where: {
          id: data.parentId,
          isActive: true,
          ...(tenantId ? { OR: [{ tenantId }, { tenantId: null }] } : {}),
        },
      });
      if (!parent) {
        throw Object.assign(new Error('Lokalizacja nadrzędna nie znaleziona'), { statusCode: 404 });
      }
      if (parent.tenantId && tenantId && parent.tenantId !== tenantId) {
        throw Object.assign(new Error('Lokalizacja nadrzędna należy do innego tenanta'), { statusCode: 400 });
      }
      fullPath = `${parent.fullPath} > ${data.name}`;
      locationTenantId = parent.tenantId ?? tenantId;
    }

    const createData = this.compactUpdateData({
      parentId: data.parentId,
      tenantId: locationTenantId,
      type: data.type,
      code: data.code,
      name: data.name,
      address: data.address,
      description: data.description,
      capacity: data.capacity,
      fullPath,
    });

    return prisma.location.create({
      data: createData as any,
    });
  }

  async update(id: string, tenantId: string | null, data: any) {
    const location = await prisma.location.findFirst({
      where: this.buildLocationWhere(id, tenantId),
    });
    if (!location) throw Object.assign(new Error('Lokalizacja nie znaleziona'), { statusCode: 404 });

    const parentId = data.parentId === undefined ? location.parentId : data.parentId || null;
    let parent: any = null;

    if (parentId) {
      if (parentId === id) {
        throw Object.assign(new Error('Lokalizacja nie może być własnym rodzicem'), { statusCode: 400 });
      }

      const descendantIds = await this.getDescendantIds(id);
      if (descendantIds.includes(parentId)) {
        throw Object.assign(new Error('Nie można przenieść lokalizacji do jej lokalizacji podrzędnej'), { statusCode: 400 });
      }

      parent = await prisma.location.findFirst({
        where: {
          id: parentId,
          isActive: true,
          ...(tenantId ? { OR: [{ tenantId }, { tenantId: null }] } : {}),
        },
      });
      if (!parent) {
        throw Object.assign(new Error('Lokalizacja nadrzędna nie znaleziona'), { statusCode: 404 });
      }
      if (parent.tenantId && tenantId && parent.tenantId !== tenantId) {
        throw Object.assign(new Error('Lokalizacja nadrzędna należy do innego tenanta'), { statusCode: 400 });
      }
      if (parent.tenantId && location.tenantId && parent.tenantId !== location.tenantId) {
        throw Object.assign(new Error('Nie można przenieść lokalizacji do innego tenanta'), { statusCode: 400 });
      }
    }

    const name = data.name ?? location.name;
    const fullPath = parent ? `${parent.fullPath} > ${name}` : name;
    const locationTenantId = parent?.tenantId ?? location.tenantId ?? tenantId;
    const updateData = this.compactUpdateData({
      parentId,
      tenantId: locationTenantId,
      type: data.type,
      code: data.code,
      name: data.name,
      address: data.address,
      description: data.description,
      capacity: data.capacity,
      isActive: data.isActive,
      fullPath,
    });

    return prisma.$transaction(async (tx) => {
      const updated = await tx.location.update({
        where: { id },
        data: updateData as any,
      });
      await this.refreshChildPaths(updated.id, updated.fullPath, tx);
      return updated;
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
