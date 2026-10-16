import { prisma } from '../../config/database';
import { OrderType, Prisma } from '@prisma/client';
import {
  BOX_STATUS_LABELS,
  DOC_TYPE_LABELS,
  EMPLOYMENT_STATUS_LABELS,
  ORDER_STATUS_LABELS,
} from '@archivecore/shared';
import { findTenantOverCapacityLocations } from './storage-health';

interface SlaBreakdownRow {
  tenantId: string;
  orderType: OrderType;
  priority: string;
  completed: number;
  breached: number;
  activeOverdue: number;
}

interface SlaTrendRow {
  month: string;
  completed: number;
  breached: number;
}

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
      totalFolders,
      activeBoxes,
      checkedOutBoxes,
      totalHRFolders,
      activeOrders,
      overdueOrders,
      locations,
      pendingDisposal,
      totalUsers,
    ] = await Promise.all([
      prisma.box.count({ where: { tenantId, deletedAt: null } }),
      prisma.folder.count({ where: { tenantId } }),
      prisma.box.count({ where: { tenantId, status: 'active', deletedAt: null } }),
      prisma.box.count({ where: { tenantId, status: 'checked_out', deletedAt: null } }),
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
      prisma.box.count({ where: { tenantId, status: { in: ['pending_disposal', 'approved_disposal'] }, deletedAt: null } }),
      prisma.user.count({ where: { tenantId, isActive: true } }),
    ]);

    const totalCapacity = locations.reduce((sum, l) => sum + (l.capacity || 0), 0);
    const totalOccupied = locations.reduce((sum, l) => sum + l.currentCount, 0);
    const occupancyRate = totalCapacity > 0 ? Math.round((totalOccupied / totalCapacity) * 100) : 0;

    return {
      totalBoxes,
      totalFolders,
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
      where: { tenantId, deletedAt: null },
      _count: true,
    });
    return this.addLabel(data, 'status', BOX_STATUS_LABELS);
  }

  async getBoxesByDocType(tenantId: string) {
    const data = await prisma.box.groupBy({
      by: ['docType'],
      where: { tenantId, deletedAt: null },
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
        where: { tenantId, locationId: { not: null }, deletedAt: null, status: { not: 'disposed' } },
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

  async getStorageHealth(tenantId: string) {
    type BoxIssue = { id: string; boxNumber: string; total: number };
    type FolderIssue = { id: string; folderNumber: string; total: number };
    const [unlocated, foreignLocation, foreignBoxFolders, locations] = await Promise.all([
      prisma.$queryRaw<BoxIssue[]>`
        SELECT b."id", b."boxNumber", COUNT(*) OVER ()::int AS "total"
        FROM "boxes" b
        WHERE b."tenantId" = ${tenantId}::uuid AND b."deletedAt" IS NULL
          AND b."status" IN ('active', 'pending_disposal', 'approved_disposal', 'damaged')
          AND b."locationId" IS NULL
        ORDER BY b."boxNumber", b."id" LIMIT 10
      `,
      prisma.$queryRaw<BoxIssue[]>`
        WITH RECURSIVE ancestors AS (
          SELECT b."id" AS "boxId", b."boxNumber", b."tenantId" AS "boxTenantId",
                 l."parentId", l."tenantId" AS "locationTenantId", ARRAY[l."id"] AS visited
          FROM "boxes" b
          JOIN "locations" l ON l."id" = b."locationId"
          WHERE b."tenantId" = ${tenantId}::uuid AND b."deletedAt" IS NULL
            AND b."status" <> 'disposed'
          UNION ALL
          SELECT a."boxId", a."boxNumber", a."boxTenantId", parent."parentId",
                 parent."tenantId", a.visited || parent."id"
          FROM ancestors a
          JOIN "locations" parent ON parent."id" = a."parentId"
          WHERE NOT parent."id" = ANY(a.visited)
        ), mismatched AS (
          SELECT DISTINCT "boxId" AS "id", "boxNumber"
          FROM ancestors
          WHERE "locationTenantId" IS NOT NULL AND "locationTenantId" <> "boxTenantId"
        )
        SELECT "id", "boxNumber", COUNT(*) OVER ()::int AS "total"
        FROM mismatched
        ORDER BY "boxNumber", "id" LIMIT 10
      `,
      prisma.$queryRaw<FolderIssue[]>`
        SELECT f."id", f."folderNumber", COUNT(*) OVER ()::int AS "total"
        FROM "folders" f
        LEFT JOIN "boxes" b ON b."id" = f."boxId"
        LEFT JOIN "transfer_list_items" item ON item."folderId" = f."id"
        LEFT JOIN "transfer_lists" list ON list."id" = item."transferListId"
        WHERE f."tenantId" = ${tenantId}::uuid
          AND (b."tenantId" <> f."tenantId" OR list."tenantId" <> f."tenantId")
        ORDER BY f."folderNumber", f."id" LIMIT 10
      `,
      prisma.location.findMany({
        select: { id: true, parentId: true, tenantId: true, fullPath: true, capacity: true, isActive: true },
      }),
    ]);

    const locationIds = locations.map((location) => location.id);
    const [allCounts, tenantCounts] = locations.length > 0 ? await Promise.all([
      prisma.box.groupBy({
        by: ['locationId'],
        where: { locationId: { in: locationIds }, deletedAt: null, status: { not: 'disposed' } },
        _count: { _all: true },
      }),
      prisma.box.groupBy({
        by: ['locationId'],
        where: { tenantId, locationId: { in: locationIds }, deletedAt: null, status: { not: 'disposed' } },
        _count: { _all: true },
      }),
    ]) : [[], []];
    const countMap = (counts: typeof allCounts) => new Map(counts.filter((row) => row.locationId).map((row) => [row.locationId!, row._count._all]));
    const overCapacity = findTenantOverCapacityLocations(locations, countMap(allCounts), countMap(tenantCounts), tenantId);

    return {
      unlocated: { total: unlocated[0]?.total ?? 0, boxes: unlocated.map(({ id, boxNumber }) => ({ id, boxNumber })) },
      overCapacity: { total: overCapacity.length, locations: overCapacity.slice(0, 10) },
      tenantMismatch: {
        total: (foreignLocation[0]?.total ?? 0) + (foreignBoxFolders[0]?.total ?? 0),
        boxes: foreignLocation.map(({ id, boxNumber }) => ({ id, boxNumber })),
        folders: foreignBoxFolders.map(({ id, folderNumber }) => ({ id, folderNumber })),
      },
    };
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
      prisma.hRFolder.count({ where: { tenantId, retentionEndDate: { lt: now }, retentionBasis: { not: 'needs_review' }, disposalStatus: 'active', litigationHold: false } }),
      prisma.hRFolder.count({ where: { tenantId, retentionEndDate: { gte: now, lt: in30 }, retentionBasis: { not: 'needs_review' }, disposalStatus: 'active', litigationHold: false } }),
      prisma.hRFolder.count({ where: { tenantId, retentionEndDate: { gte: in30, lt: in90 }, retentionBasis: { not: 'needs_review' }, disposalStatus: 'active', litigationHold: false } }),
      prisma.hRFolder.count({ where: { tenantId, retentionEndDate: { gte: in90, lt: in365 }, retentionBasis: { not: 'needs_review' }, disposalStatus: 'active', litigationHold: false } }),
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

  async getSlaBreakdown(tenantId: string | undefined, days: number, now = new Date(), orderType?: OrderType) {
    const since = new Date(now.getTime() - days * 24 * 60 * 60_000);
    const tenantFilter = tenantId ? Prisma.sql`AND "tenantId" = ${tenantId}::uuid` : Prisma.empty;
    const orderTypeFilter = orderType ? Prisma.sql`AND "orderType" = ${orderType}::"OrderType"` : Prisma.empty;
    const rows = await prisma.$queryRaw<SlaBreakdownRow[]>(Prisma.sql`
      SELECT "tenantId", "orderType", "priority",
        COUNT(*) FILTER (WHERE "status" = 'completed' AND "completedAt" >= ${since} AND "completedAt" <= ${now})::int AS "completed",
        COUNT(*) FILTER (WHERE "status" = 'completed' AND "completedAt" >= ${since} AND "completedAt" <= ${now} AND "completedAt" > "slaDeadline")::int AS "breached",
        COUNT(*) FILTER (WHERE "status" IN ('submitted', 'approved', 'in_progress', 'ready') AND "slaDeadline" < ${now})::int AS "activeOverdue"
      FROM "orders"
      WHERE (
        ("status" = 'completed' AND "completedAt" >= ${since} AND "completedAt" <= ${now} AND "slaDeadline" IS NOT NULL)
        OR ("status" IN ('submitted', 'approved', 'in_progress', 'ready') AND "slaDeadline" < ${now})
      ) ${tenantFilter} ${orderTypeFilter}
      GROUP BY "tenantId", "orderType", "priority"
    `);
    const tenantIds = [...new Set(rows.map((row) => row.tenantId))];
    const tenants = tenantIds.length ? await prisma.tenant.findMany({
      where: { id: { in: tenantIds } },
      select: { id: true, name: true },
    }) : [];
    const names = new Map(tenants.map((tenant) => [tenant.id, tenant.name]));
    const orderTypeOrder: Record<string, number> = { checkout: 0, return_order: 1, transfer: 2, disposal: 3, scan: 4 };
    const priorityOrder: Record<string, number> = { urgent: 0, high: 1, normal: 2 };
    const data = rows.map((row) => ({
      ...row,
      tenantName: names.get(row.tenantId) || row.tenantId,
      onTime: row.completed - row.breached,
      slaRate: row.completed ? Math.round((row.completed - row.breached) / row.completed * 100) : null,
    })).sort((a, b) => a.tenantName.localeCompare(b.tenantName, 'pl')
      || (orderTypeOrder[a.orderType] ?? 5) - (orderTypeOrder[b.orderType] ?? 5)
      || (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3));
    const totals = data.reduce((sum, row) => ({
      completed: sum.completed + row.completed,
      breached: sum.breached + row.breached,
      activeOverdue: sum.activeOverdue + row.activeOverdue,
    }), { completed: 0, breached: 0, activeOverdue: 0 });
    return { days, since, asOf: now, orderType: orderType ?? null, data, totals };
  }

  async getSlaTrend(tenantId: string | undefined, days: number, now = new Date(), orderType?: OrderType) {
    const since = new Date(now.getTime() - days * 24 * 60 * 60_000);
    const tenantFilter = tenantId ? Prisma.sql`AND "tenantId" = ${tenantId}::uuid` : Prisma.empty;
    const orderTypeFilter = orderType ? Prisma.sql`AND "orderType" = ${orderType}::"OrderType"` : Prisma.empty;
    const rows = await prisma.$queryRaw<SlaTrendRow[]>(Prisma.sql`
      WITH monthly AS (
        SELECT to_char("completedAt" AT TIME ZONE 'Europe/Warsaw', 'YYYY-MM') AS "month",
          COUNT(*)::int AS "completed",
          COUNT(*) FILTER (WHERE "completedAt" > "slaDeadline")::int AS "breached"
        FROM "orders"
        WHERE "status" = 'completed' AND "slaDeadline" IS NOT NULL
          AND "completedAt" >= ${since} AND "completedAt" <= ${now}
          ${tenantFilter} ${orderTypeFilter}
        GROUP BY 1
      )
      SELECT to_char(months.month, 'YYYY-MM') AS "month",
        COALESCE(monthly."completed", 0)::int AS "completed",
        COALESCE(monthly."breached", 0)::int AS "breached"
      FROM generate_series(
        date_trunc('month', ${since} AT TIME ZONE 'Europe/Warsaw'),
        date_trunc('month', ${now} AT TIME ZONE 'Europe/Warsaw'),
        interval '1 month'
      ) AS months(month)
      LEFT JOIN monthly ON monthly."month" = to_char(months.month, 'YYYY-MM')
      ORDER BY months.month
    `);
    return {
      days, since, asOf: now, orderType: orderType ?? null,
      months: rows.map((row) => ({
        ...row,
        onTime: row.completed - row.breached,
        slaRate: row.completed ? Math.round((row.completed - row.breached) / row.completed * 100) : null,
      })),
    };
  }
}

export const reportService = new ReportService();
