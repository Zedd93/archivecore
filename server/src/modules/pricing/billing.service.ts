import { BillingEventStatus, Prisma, PriceListStatus } from '@prisma/client';
import { PRICING_SERVICES, PricingServiceCode } from '@archivecore/shared';
import { prisma } from '../../config/database';

const serviceCatalog = new Map(PRICING_SERVICES.map((service) => [service.code, service]));

function startOfUtcDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function billingPeriodFor(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

function dayAfter(value: Date) {
  const result = startOfUtcDay(value);
  result.setUTCDate(result.getUTCDate() + 1);
  return result;
}

function monthRange(month?: string) {
  const now = new Date();
  const [year, monthIndex] = month
    ? month.split('-').map(Number)
    : [now.getUTCFullYear(), now.getUTCMonth() + 1];
  const start = new Date(Date.UTC(year, monthIndex - 1, 1));
  const end = new Date(Date.UTC(year, monthIndex, 1));
  return { start, end };
}

function getOrderItemLabel(item: any) {
  if (item.box) return `Karton ${item.box.boxNumber}`;
  if (item.folder) return `Teczka ${item.folder.folderNumber}`;
  if (item.document) return `Dokument: ${item.document.title}`;
  if (item.transferListItem) return `Teczka ${item.transferListItem.folderSignature}`;
  if (item.hrFolder) return `Akta: ${item.hrFolder.employeeLastName} ${item.hrFolder.employeeFirstName}`;
  return 'Pozycja zlecenia';
}

function getDeliveryServiceCode(orderType: string, item: any): PricingServiceCode | null {
  const isBox = Boolean(item.boxId);
  if (orderType === 'checkout') return isBox ? 'retrieval_box' : 'retrieval_folder';
  if (orderType === 'return_order') return isBox ? 'return_box' : 'return_folder';
  if (orderType === 'disposal' && isBox) return 'destruction_box';
  return null;
}

export class BillingService {
  async buildOrderDeliveryEvents(order: any, occurredAt: Date): Promise<Prisma.BillingEventCreateManyInput[]> {
    const eventDate = startOfUtcDay(occurredAt);
    const priceList = await prisma.priceList.findFirst({
      where: {
        tenantId: order.tenantId,
        status: { in: [PriceListStatus.active, PriceListStatus.archived] },
        validFrom: { lte: eventDate },
        OR: [{ validTo: null }, { validTo: { gte: eventDate } }],
      },
      orderBy: { validFrom: 'desc' },
      include: { items: { where: { isActive: true } } },
    });

    const rates = new Map(priceList?.items.map((item) => [item.serviceCode, item]) || []);

    return order.items.flatMap((item: any) => {
      const serviceCode = getDeliveryServiceCode(order.orderType, item);
      if (!serviceCode) return [];

      const catalogEntry = serviceCatalog.get(serviceCode);
      if (!catalogEntry) return [];

      const rate = rates.get(serviceCode);
      const quantity = new Prisma.Decimal(1);

      return [{
        tenantId: order.tenantId,
        priceListId: priceList?.id,
        priceListItemId: rate?.id,
        orderId: order.id,
        orderItemId: item.id,
        serviceCode,
        serviceName: rate?.serviceName || catalogEntry.defaultName,
        unit: rate?.unit || catalogEntry.unit,
        quantity,
        unitPrice: rate?.unitPrice,
        netAmount: rate ? rate.unitPrice.mul(quantity) : null,
        vatRate: rate?.vatRate || new Prisma.Decimal(23),
        currency: priceList?.currency || 'PLN',
        sourceType: 'order_delivery',
        sourceId: item.id,
        description: `${order.orderNumber}: ${getOrderItemLabel(item)}`,
        occurredAt,
        billingPeriod: billingPeriodFor(occurredAt),
        status: rate ? BillingEventStatus.pending : BillingEventStatus.unpriced,
      }];
    });
  }

  async listForTenant(tenantId: string, filters: any, skip: number, take: number) {
    const { start, end } = monthRange(filters.month);
    const baseWhere: Prisma.BillingEventWhereInput = {
      tenantId,
      billingPeriod: { gte: start, lt: end },
    };
    const where: Prisma.BillingEventWhereInput = {
      ...baseWhere,
      ...(filters.status ? { status: filters.status as BillingEventStatus } : {}),
    };

    const [data, total, groupedStatuses, pendingTotals] = await Promise.all([
      prisma.billingEvent.findMany({
        where,
        skip,
        take,
        orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
        include: {
          order: { select: { id: true, orderNumber: true, orderType: true } },
        },
      }),
      prisma.billingEvent.count({ where }),
      prisma.billingEvent.groupBy({
        by: ['status'],
        where: baseWhere,
        _count: { _all: true },
      }),
      prisma.billingEvent.aggregate({
        where: { ...baseWhere, status: BillingEventStatus.pending },
        _sum: { netAmount: true },
      }),
    ]);

    const counts = Object.fromEntries(groupedStatuses.map((row) => [row.status, row._count._all]));
    return {
      data,
      total,
      summary: {
        pending: counts.pending || 0,
        unpriced: counts.unpriced || 0,
        excluded: counts.excluded || 0,
        invoiced: counts.invoiced || 0,
        pendingNetAmount: pendingTotals._sum.netAmount || new Prisma.Decimal(0),
      },
    };
  }

  async exclude(id: string, reason: string) {
    const event = await prisma.billingEvent.findUnique({ where: { id } });
    if (!event) throw Object.assign(new Error('Pozycja rozliczeniowa nie istnieje'), { statusCode: 404 });
    if (event.status === BillingEventStatus.invoiced) {
      throw Object.assign(new Error('Nie można wyłączyć zafakturowanej pozycji'), { statusCode: 409 });
    }

    return prisma.billingEvent.update({
      where: { id },
      data: { status: BillingEventStatus.excluded, excludedReason: reason.trim() },
    });
  }

  async restore(id: string) {
    const event = await prisma.billingEvent.findUnique({ where: { id } });
    if (!event) throw Object.assign(new Error('Pozycja rozliczeniowa nie istnieje'), { statusCode: 404 });
    if (event.status !== BillingEventStatus.excluded) {
      throw Object.assign(new Error('Przywrócić można wyłącznie wyłączoną pozycję'), { statusCode: 409 });
    }

    return prisma.billingEvent.update({
      where: { id },
      data: {
        status: event.netAmount == null ? BillingEventStatus.unpriced : BillingEventStatus.pending,
        excludedReason: null,
      },
    });
  }

  async repriceUnpricedForPriceList(
    priceListId: string,
    db: typeof prisma | Prisma.TransactionClient = prisma
  ) {
    const priceList = await db.priceList.findUnique({
      where: { id: priceListId },
      include: { items: { where: { isActive: true } } },
    });
    if (!priceList) return 0;

    const eventDateRange = {
      gte: priceList.validFrom,
      ...(priceList.validTo ? { lt: dayAfter(priceList.validTo) } : {}),
    };
    let updatedCount = 0;
    for (const item of priceList.items) {
      const pendingResult = await db.billingEvent.updateMany({
        where: {
          tenantId: priceList.tenantId,
          serviceCode: item.serviceCode,
          status: BillingEventStatus.unpriced,
          occurredAt: eventDateRange,
        },
        data: {
          priceListId: priceList.id,
          priceListItemId: item.id,
          serviceName: item.serviceName,
          unit: item.unit,
          unitPrice: item.unitPrice,
          netAmount: item.unitPrice,
          vatRate: item.vatRate,
          currency: priceList.currency,
          status: BillingEventStatus.pending,
        },
      });
      const excludedResult = await db.billingEvent.updateMany({
        where: {
          tenantId: priceList.tenantId,
          serviceCode: item.serviceCode,
          status: BillingEventStatus.excluded,
          netAmount: null,
          occurredAt: eventDateRange,
        },
        data: {
          priceListId: priceList.id,
          priceListItemId: item.id,
          serviceName: item.serviceName,
          unit: item.unit,
          unitPrice: item.unitPrice,
          netAmount: item.unitPrice,
          vatRate: item.vatRate,
          currency: priceList.currency,
        },
      });
      updatedCount += pendingResult.count + excludedResult.count;
    }

    return updatedCount;
  }
}

export const billingService = new BillingService();
