import { BillingEventStatus, BillingPeriodStatus, Prisma, PriceListStatus } from '@prisma/client';
import { PRICING_SERVICES, PricingServiceCode } from '@archivecore/shared';
import { v5 as uuidv5 } from 'uuid';
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

function storageSourceId(boxId: string, month: string) {
  return uuidv5(`archivecore:monthly-storage:${boxId}:${month}`, uuidv5.DNS);
}

function conflict(message: string) {
  return Object.assign(new Error(message), { statusCode: 409 });
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
  private async findPriceList(tenantId: string, eventDate: Date, db: typeof prisma | Prisma.TransactionClient = prisma) {
    return db.priceList.findFirst({
      where: {
        tenantId,
        status: { in: [PriceListStatus.active, PriceListStatus.archived] },
        validFrom: { lte: eventDate },
        OR: [{ validTo: null }, { validTo: { gte: eventDate } }],
      },
      orderBy: { validFrom: 'desc' },
      include: { items: { where: { isActive: true } } },
    });
  }

  private async assertPeriodOpen(tenantId: string, periodStart: Date, db: typeof prisma | Prisma.TransactionClient = prisma) {
    const period = await db.billingPeriod.findUnique({
      where: { tenantId_periodStart: { tenantId, periodStart } },
    });
    if (period?.status === BillingPeriodStatus.closed) {
      throw conflict('Miesiąc rozliczeniowy jest zamknięty');
    }
  }

  async buildOrderDeliveryEvents(order: any, occurredAt: Date): Promise<Prisma.BillingEventCreateManyInput[]> {
    const eventDate = startOfUtcDay(occurredAt);
    await this.assertPeriodOpen(order.tenantId, billingPeriodFor(occurredAt));
    const priceList = await this.findPriceList(order.tenantId, eventDate);

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

  async buildBoxIntakeEvents(
    boxes: Array<{ id: string; boxNumber: string }>, tenantId: string, occurredAt: Date, db: typeof prisma | Prisma.TransactionClient = prisma,
  ): Promise<Prisma.BillingEventCreateManyInput[]> {
    const periodStart = billingPeriodFor(occurredAt);
    await this.assertPeriodOpen(tenantId, periodStart, db);
    const priceList = await this.findPriceList(tenantId, startOfUtcDay(occurredAt), db);
    const rate = priceList?.items.find((item) => item.serviceCode === 'intake_box');
    const catalogEntry = serviceCatalog.get('intake_box')!;
    return boxes.map((box) => ({
      tenantId,
      priceListId: priceList?.id,
      priceListItemId: rate?.id,
      serviceCode: 'intake_box',
      serviceName: rate?.serviceName || catalogEntry.defaultName,
      unit: rate?.unit || catalogEntry.unit,
      quantity: new Prisma.Decimal(1),
      unitPrice: rate?.unitPrice,
      netAmount: rate?.unitPrice || null,
      vatRate: rate?.vatRate || new Prisma.Decimal(23),
      currency: priceList?.currency || 'PLN',
      sourceType: 'box_intake',
      sourceId: box.id,
      description: `Przyjęcie kartonu ${box.boxNumber}`,
      occurredAt,
      billingPeriod: periodStart,
      status: rate ? BillingEventStatus.pending : BillingEventStatus.unpriced,
    }));
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

    const [data, total, groupedStatuses, pendingTotals, period] = await Promise.all([
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
      prisma.billingPeriod.findUnique({
        where: { tenantId_periodStart: { tenantId, periodStart: start } },
        include: { closedBy: { select: { id: true, firstName: true, lastName: true } } },
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
      period,
    };
  }

  async generateMonthlyStorage(tenantId: string, month: string) {
    const { start, end } = monthRange(month);
    const currentPeriod = billingPeriodFor(new Date());
    if (start > currentPeriod) {
      throw Object.assign(new Error('Nie można naliczyć przechowywania za przyszły miesiąc'), { statusCode: 400 });
    }

    return prisma.$transaction(async (tx) => {
      const existingPeriod = await tx.billingPeriod.findUnique({
        where: { tenantId_periodStart: { tenantId, periodStart: start } },
      });
      if (existingPeriod?.status === BillingPeriodStatus.closed) {
        throw conflict('Miesiąc rozliczeniowy jest zamknięty');
      }

      const [boxes, priceList] = await Promise.all([
        tx.box.findMany({
          where: {
            tenantId,
            createdAt: { lt: end },
            location: { is: { isBillableStorage: true } },
            AND: [
              { OR: [{ deletedAt: null }, { deletedAt: { gte: start } }] },
              { OR: [{ disposalDate: null }, { disposalDate: { gte: start } }] },
            ],
          },
          select: { id: true, boxNumber: true, title: true },
        }),
        this.findPriceList(tenantId, start, tx),
      ]);

      const rate = priceList?.items.find((item) => item.serviceCode === 'storage_box_month');
      const catalogEntry = serviceCatalog.get('storage_box_month')!;
      const created = await tx.billingEvent.createMany({
        data: boxes.map((box) => ({
          tenantId,
          priceListId: priceList?.id,
          priceListItemId: rate?.id,
          serviceCode: 'storage_box_month',
          serviceName: rate?.serviceName || catalogEntry.defaultName,
          unit: rate?.unit || catalogEntry.unit,
          quantity: new Prisma.Decimal(1),
          unitPrice: rate?.unitPrice,
          netAmount: rate?.unitPrice,
          vatRate: rate?.vatRate || new Prisma.Decimal(23),
          currency: priceList?.currency || 'PLN',
          sourceType: 'monthly_storage',
          sourceId: storageSourceId(box.id, month),
          description: `Przechowywanie: karton ${box.boxNumber} — ${box.title}`,
          occurredAt: start,
          billingPeriod: start,
          status: rate ? BillingEventStatus.pending : BillingEventStatus.unpriced,
        })),
        skipDuplicates: true,
      });

      const period = await tx.billingPeriod.upsert({
        where: { tenantId_periodStart: { tenantId, periodStart: start } },
        create: { tenantId, periodStart: start, generatedAt: new Date() },
        update: { generatedAt: new Date() },
      });

      return { id: period.id, period, eligibleBoxes: boxes.length, createdEvents: created.count };
    });
  }

  async closePeriod(tenantId: string, month: string, userId: string) {
    const { start, end } = monthRange(month);
    if (start >= billingPeriodFor(new Date())) {
      throw conflict('Bieżący miesiąc można zamknąć dopiero po jego zakończeniu');
    }

    return prisma.$transaction(async (tx) => {
      const period = await tx.billingPeriod.findUnique({
        where: { tenantId_periodStart: { tenantId, periodStart: start } },
      });
      if (!period?.generatedAt) {
        throw conflict('Najpierw nalicz przechowywanie za wybrany miesiąc');
      }
      if (period.status === BillingPeriodStatus.closed) {
        throw conflict('Miesiąc rozliczeniowy jest już zamknięty');
      }

      const baseWhere: Prisma.BillingEventWhereInput = {
        tenantId,
        billingPeriod: { gte: start, lt: end },
      };
      const unpriced = await tx.billingEvent.count({
        where: { ...baseWhere, status: BillingEventStatus.unpriced },
      });
      if (unpriced > 0) {
        throw conflict(`Nie można zamknąć miesiąca: ${unpriced} pozycji nie ma ceny`);
      }

      const [pending, priceList] = await Promise.all([
        tx.billingEvent.aggregate({
          where: { ...baseWhere, status: BillingEventStatus.pending },
          _sum: { netAmount: true },
        }),
        this.findPriceList(tenantId, start, tx),
      ]);
      const pendingNetAmount = pending._sum.netAmount || new Prisma.Decimal(0);
      const minimumMonthlyFee = priceList?.minimumMonthlyFee;
      let minimumFeeAdjustment = new Prisma.Decimal(0);

      if (minimumMonthlyFee && minimumMonthlyFee.greaterThan(pendingNetAmount)) {
        minimumFeeAdjustment = minimumMonthlyFee.minus(pendingNetAmount);
        await tx.billingEvent.create({
          data: {
            tenantId,
            priceListId: priceList.id,
            serviceCode: 'minimum_monthly_fee',
            serviceName: 'Dopłata do minimalnej opłaty miesięcznej',
            unit: 'order',
            quantity: new Prisma.Decimal(1),
            unitPrice: minimumFeeAdjustment,
            netAmount: minimumFeeAdjustment,
            vatRate: new Prisma.Decimal(23),
            currency: priceList.currency,
            sourceType: 'monthly_minimum',
            sourceId: period.id,
            description: `Uzupełnienie do minimum za ${month}`,
            occurredAt: new Date(end.getTime() - 1),
            billingPeriod: start,
            status: BillingEventStatus.pending,
          },
        });
      }

      const closedPeriod = await tx.billingPeriod.update({
        where: { id: period.id },
        data: {
          status: BillingPeriodStatus.closed,
          closedAt: new Date(),
          closedById: userId,
        },
      });

      return {
        ...closedPeriod,
        pendingNetAmount: pendingNetAmount.plus(minimumFeeAdjustment),
        minimumFeeAdjustment,
      };
    });
  }

  async exclude(id: string, reason: string) {
    const event = await prisma.billingEvent.findUnique({ where: { id } });
    if (!event) throw Object.assign(new Error('Pozycja rozliczeniowa nie istnieje'), { statusCode: 404 });
    await this.assertPeriodOpen(event.tenantId, event.billingPeriod);
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
    await this.assertPeriodOpen(event.tenantId, event.billingPeriod);
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

    const closedPeriods = await db.billingPeriod.findMany({
      where: {
        tenantId: priceList.tenantId,
        status: BillingPeriodStatus.closed,
      },
      select: { periodStart: true },
    });
    const mutablePeriodWhere = closedPeriods.length > 0
      ? { notIn: closedPeriods.map((period) => period.periodStart) }
      : undefined;

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
          billingPeriod: mutablePeriodWhere,
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
          billingPeriod: mutablePeriodWhere,
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
