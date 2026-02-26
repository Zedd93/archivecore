import { prisma } from '../../config/database';

export interface DashboardKPIs {
  totalBoxes: number;
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
  async getDashboardKPIs(tenantId: string): Promise<DashboardKPIs> {
    const [
      totalBoxes,
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
    return prisma.box.groupBy({
      by: ['status'],
      where: { tenantId },
      _count: true,
    });
  }

  async getBoxesByDocType(tenantId: string) {
    return prisma.box.groupBy({
      by: ['docType'],
      where: { tenantId },
      _count: true,
      orderBy: { _count: { docType: 'desc' } },
      take: 15,
    });
  }

  async getOrdersByStatus(tenantId: string) {
    return prisma.order.groupBy({
      by: ['status'],
      where: { tenantId },
      _count: true,
    });
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
    return prisma.location.findMany({
      where: { tenantId, type: { in: ['rack', 'shelf'] } },
      select: {
        id: true,
        code: true,
        name: true,
        fullPath: true,
        capacity: true,
        currentCount: true,
        type: true,
      },
      orderBy: { fullPath: 'asc' },
    });
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
    return prisma.hRFolder.groupBy({
      by: ['employmentStatus'],
      where: { tenantId },
      _count: true,
    });
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
