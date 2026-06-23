import { prisma } from '../../config/database';
import {
  BOX_STATUS_LABELS,
  DOC_TYPE_LABELS,
  EMPLOYMENT_STATUS_LABELS,
  ORDER_STATUS_LABELS,
} from '@archivecore/shared';

export interface DashboardKPIs {
  totalBoxes: number;
  totalFolders: number;
  activeBoxes: number;
  checkedOutBoxes: number;
  totalHRFolders: number;
  activeOrders: number;
  overdueOrders: number;
  totalLocations: number;
  occupancyRate: number;
  pendingDisposal: number;
  totalUsers: number;
}

export class ReportService {
  private addLabel<T extends Record<string, any>>(rows: T[], key: keyof T, labels: Record<string, string>) {
    return rows.map((row) => ({
      ...row,
      label: labels[String(row[key])] || String(row[key] || ''),
    }));
  }

  private getDescendantIds(locationId: string, childrenByParent: Map<string, string[]>): string[] {
    const ids: string[] = [];
    const stack = [locationId];

    while (stack.length > 0) {
      const currentId = stack.pop()!;
      ids.push(currentId);
      stack.push(...(childrenByParent.get(currentId) ?? []));
    }

    return ids;
  }

  async getDashboardKPIs(tenantId: string): Promise<DashboardKPIs> {
    const [
      totalBoxes,
      manualFolders,
      transferListFolders,
      activeBoxes,
      checkedOutBoxes,
      totalHRFolders,
      activeOrders,
      overdueOrders,
      locations,
      pendingDisposal,
      totalUsers,
    ] = await Promise.all([
      prisma.box.count({ where: { tenantId } }),
      prisma.folder.count({ where: { tenantId } }),
      prisma.transferListItem.count({ where: { transferList: { tenantId } } }),
      prisma.box.count({ where: { tenantId, status: 'active' } }),
      prisma.box.count({ where: { tenantId, status: 'checked_out' } }),
      prisma.hRFolder.count({ where: { tenantId } }),
      prisma.order.count({
        where: { tenantId, status: { notIn: ['completed', 'cancelled'] } },
      }),
      prisma.order.count({
        where: { tenantId, status: { notIn: ['completed', 'cancelled'] }, slaDeadline: { lt: new Date() } },
      }),
      prisma.location.findMany({
        where: { tenantId, type: 'slot' },
        select: { capacity: true, currentCount: true },
      }),
      prisma.box.count({ where: { tenantId, status: 'pending_disposal' } }),
      prisma.user.count({ where: { tenantId, isActive: true } }),
    ]);

    const totalCapacity = locations.reduce((sum, l) => sum + (l.capacity || 0), 0);
    const totalOccupied = locations.reduce((sum, l) => sum + l.currentCount, 0);
    const occupancyRate = totalCapacity > 0 ? Math.round((totalOccupied / totalCapacity) * 100) : 0;

    return {
      totalBoxes,
      totalFolders: manualFolders + transferListFolders,
      activeBoxes,
      checkedOutBoxes,
      totalHRFolders,
      activeOrders,
      overdueOrders,
      totalLocations: locations.length,
      occupancyRate,
      pendingDisposal,
      totalUsers,
    };
  }

  async getBoxesByStatus(tenantId: string) {
    const data = await prisma.box.groupBy({
      by: ['status'],
      where: { tenantId },
      _count: true,
    });
    return this.addLabel(data, 'status', BOX_STATUS_LABELS);
  }

  async getBoxesByDocType(tenantId: string) {
    const data = await prisma.box.groupBy({
      by: ['docType'],
      where: { tenantId },
      _count: true,
      orderBy: { _count: { docType: 'desc' } },
      take: 15,
    });
    return this.addLabel(data, 'docType', DOC_TYPE_LABELS);
  }

  async getOrdersByStatus(tenantId: string) {
    const data = await prisma.order.groupBy({
      by: ['status'],
      where: { tenantId },
      _count: true,
    });
    return this.addLabel(data, 'status', ORDER_STATUS_LABELS);
  }

  async getOrdersByMonth(tenantId: string, months: number = 12) {
    const since = new Date();
    since.setMonth(since.getMonth() - months);

    const orders = await prisma.order.findMany({
      where: { tenantId, createdAt: { gte: since } },
      select: { createdAt: true, orderType: true },
    });

    const byMonth: Record<string, Record<string, number>> = {};
    for (const order of orders) {
      const key = `${order.createdAt.getFullYear()}-${(order.createdAt.getMonth() + 1).toString().padStart(2, '0')}`;
      if (!byMonth[key]) byMonth[key] = {};
      byMonth[key][order.orderType] = (byMonth[key][order.orderType] || 0) + 1;
    }

    return Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, types]) => ({ month, ...types }));
  }

  async getLocationOccupancy(tenantId: string) {
    const [locations, boxesByLocation] = await Promise.all([
      prisma.location.findMany({
        where: { tenantId, isActive: true },
        select: {
          id: true,
          parentId: true,
          code: true,
          name: true,
          fullPath: true,
          capacity: true,
          currentCount: true,
          type: true,
        },
        orderBy: { fullPath: 'asc' },
      }),
      prisma.box.groupBy({
        by: ['locationId'],
        where: { tenantId, locationId: { not: null } },
        _count: true,
      }),
    ]);

    const directCounts = new Map<string, number>();
    for (const row of boxesByLocation) {
      if (row.locationId) directCounts.set(row.locationId, row._count);
    }

    const locationsById = new Map(locations.map((location) => [location.id, location]));
    const childrenByParent = new Map<string, string[]>();
    for (const location of locations) {
      if (!location.parentId) continue;
      const children = childrenByParent.get(location.parentId) ?? [];
      children.push(location.id);
      childrenByParent.set(location.parentId, children);
    }

    const descendantsCache = new Map<string, string[]>();
    const getDescendantIds = (locationId: string) => {
      const cached = descendantsCache.get(locationId);
      if (cached) return cached;

      const ids = this.getDescendantIds(locationId, childrenByParent);
      descendantsCache.set(locationId, ids);
      return ids;
    };

    const getAggregatedCount = (locationId: string) =>
      getDescendantIds(locationId).reduce((sum, id) => sum + (directCounts.get(id) ?? 0), 0);

    const getDescendantCapacity = (locationId: string) =>
      getDescendantIds(locationId)
        .filter((id) => id !== locationId)
        .reduce((sum, id) => sum + (locationsById.get(id)?.capacity ?? 0), 0);

    const toReportNode = (location: (typeof locations)[number]) => ({
      ...location,
      currentCount: directCounts.get(location.id) ?? 0,
      aggregatedCount: getAggregatedCount(location.id),
      ownCapacity: location.capacity,
      capacity: location.capacity ?? getDescendantCapacity(location.id),
    });

    return locations
      .filter((location) => location.type === 'warehouse')
      .map((warehouse) => {
        const detailLocations = getDescendantIds(warehouse.id)
          .filter((id) => id !== warehouse.id)
          .map((id) => locationsById.get(id))
          .filter((location): location is (typeof locations)[number] => Boolean(location))
          .map(toReportNode)
          .sort((a, b) => a.fullPath.localeCompare(b.fullPath, 'pl', { numeric: true }));

        return {
          ...toReportNode(warehouse),
          children: detailLocations,
        };
      })
      .sort((a, b) => a.fullPath.localeCompare(b.fullPath, 'pl', { numeric: true }));
  }

  async getHRFoldersByDepartment(tenantId: string) {
    return prisma.hRFolder.groupBy({
      by: ['department'],
      where: { tenantId },
      _count: true,
      orderBy: { _count: { department: 'desc' } },
    });
  }

  async getHRFoldersByStatus(tenantId: string) {
    const data = await prisma.hRFolder.groupBy({
      by: ['employmentStatus'],
      where: { tenantId },
      _count: true,
    });
    return this.addLabel(data, 'employmentStatus', EMPLOYMENT_STATUS_LABELS);
  }

  async getRetentionSummary(tenantId: string) {
    const now = new Date();
    const in30 = new Date(); in30.setDate(in30.getDate() + 30);
    const in90 = new Date(); in90.setDate(in90.getDate() + 90);
    const in365 = new Date(); in365.setDate(in365.getDate() + 365);

    const [expired, within30, within90, within365, onHold] = await Promise.all([
      prisma.hRFolder.count({ where: { tenantId, retentionEndDate: { lt: now }, disposalStatus: 'active' } }),
      prisma.hRFolder.count({ where: { tenantId, retentionEndDate: { gte: now, lt: in30 }, disposalStatus: 'active' } }),
      prisma.hRFolder.count({ where: { tenantId, retentionEndDate: { gte: in30, lt: in90 }, disposalStatus: 'active' } }),
      prisma.hRFolder.count({ where: { tenantId, retentionEndDate: { gte: in90, lt: in365 }, disposalStatus: 'active' } }),
      prisma.hRFolder.count({ where: { tenantId, litigationHold: true } }),
    ]);

    return { expired, within30, within90, within365, onHold };
  }

  async getAuditActivity(tenantId: string, days: number = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const logs = await prisma.auditLog.findMany({
      where: { tenantId, createdAt: { gte: since } },
      select: { createdAt: true, action: true },
    });

    const byDay: Record<string, number> = {};
    for (const log of logs) {
      const key = log.createdAt.toISOString().split('T')[0];
      byDay[key] = (byDay[key] || 0) + 1;
    }

    return Object.entries(byDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }));
  }

  async getSlaPerformance(tenantId: string, months: number = 6) {
    const since = new Date();
    since.setMonth(since.getMonth() - months);

    const orders = await prisma.order.findMany({
      where: {
        tenantId,
        status: 'completed',
        completedAt: { gte: since },
        slaDeadline: { not: null },
      },
      select: { completedAt: true, slaDeadline: true, createdAt: true },
    });

    const total = orders.length;
    const onTime = orders.filter(o => o.completedAt && o.slaDeadline && o.completedAt <= o.slaDeadline).length;
    const slaRate = total > 0 ? Math.round((onTime / total) * 100) : 100;

    return { total, onTime, overdue: total - onTime, slaRate };
  }
}

export const reportService = new ReportService();
