import { Prisma, PriceListStatus } from '@prisma/client';
import { prisma } from '../../config/database';

function toDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function toItemCreateData(item: any) {
  return {
    serviceCode: item.serviceCode,
    serviceName: item.serviceName,
    unit: item.unit,
    unitPrice: new Prisma.Decimal(item.unitPrice),
    vatRate: new Prisma.Decimal(item.vatRate ?? 23),
    minimumQuantity: item.minimumQuantity == null ? null : new Prisma.Decimal(item.minimumQuantity),
    isActive: item.isActive ?? true,
  };
}

export class PricingService {
  private async ensureTenant(tenantId: string) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true },
    });
    if (!tenant) throw Object.assign(new Error('Tenant nie znaleziony'), { statusCode: 404 });
    return tenant;
  }

  private async getById(id: string) {
    const priceList = await prisma.priceList.findUnique({
      where: { id },
      include: {
        tenant: { select: { id: true, name: true, shortCode: true } },
        items: { orderBy: { serviceName: 'asc' } },
      },
    });
    if (!priceList) throw Object.assign(new Error('Cennik nie znaleziony'), { statusCode: 404 });
    return priceList;
  }

  async listForTenant(tenantId: string) {
    await this.ensureTenant(tenantId);
    return prisma.priceList.findMany({
      where: { tenantId },
      orderBy: [{ status: 'asc' }, { validFrom: 'desc' }, { createdAt: 'desc' }],
      include: {
        items: { orderBy: { serviceName: 'asc' } },
      },
    });
  }

  async create(tenantId: string, data: any) {
    await this.ensureTenant(tenantId);
    return prisma.priceList.create({
      data: {
        tenantId,
        name: data.name.trim(),
        currency: data.currency,
        validFrom: toDate(data.validFrom),
        minimumMonthlyFee: data.minimumMonthlyFee == null
          ? null
          : new Prisma.Decimal(data.minimumMonthlyFee),
        status: PriceListStatus.draft,
        items: { create: data.items.map(toItemCreateData) },
      },
      include: { items: { orderBy: { serviceName: 'asc' } } },
    });
  }

  async update(id: string, data: any) {
    const priceList = await this.getById(id);
    if (priceList.status !== PriceListStatus.draft) {
      throw Object.assign(
        new Error('Można edytować wyłącznie roboczą wersję cennika. Utwórz nową wersję, aby zmienić aktywne stawki.'),
        { statusCode: 409 }
      );
    }

    return prisma.$transaction(async (tx) => {
      await tx.priceListItem.deleteMany({ where: { priceListId: id } });
      return tx.priceList.update({
        where: { id },
        data: {
          name: data.name.trim(),
          currency: data.currency,
          validFrom: toDate(data.validFrom),
          minimumMonthlyFee: data.minimumMonthlyFee == null
            ? null
            : new Prisma.Decimal(data.minimumMonthlyFee),
          items: { create: data.items.map(toItemCreateData) },
        },
        include: { items: { orderBy: { serviceName: 'asc' } } },
      });
    });
  }

  async activate(id: string) {
    const priceList = await this.getById(id);
    if (priceList.status !== PriceListStatus.draft) {
      throw Object.assign(new Error('Można aktywować wyłącznie roboczą wersję cennika'), { statusCode: 409 });
    }
    if (priceList.items.length === 0) {
      throw Object.assign(new Error('Nie można aktywować cennika bez stawek'), { statusCode: 400 });
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    if (priceList.validFrom > today) {
      throw Object.assign(
        new Error('Cennik z przyszłą datą może pozostać wersją roboczą. Aktywuj go w dniu rozpoczęcia obowiązywania.'),
        { statusCode: 400 }
      );
    }

    const currentPriceList = await prisma.priceList.findFirst({
      where: { tenantId: priceList.tenantId, status: PriceListStatus.active },
      select: { id: true, validFrom: true },
    });
    if (currentPriceList && priceList.validFrom <= currentPriceList.validFrom) {
      throw Object.assign(
        new Error('Data nowej wersji musi być późniejsza niż data rozpoczęcia aktualnego cennika.'),
        { statusCode: 409 }
      );
    }

    const closeDate = new Date(priceList.validFrom);
    closeDate.setUTCDate(closeDate.getUTCDate() - 1);

    return prisma.$transaction(async (tx) => {
      await tx.priceList.updateMany({
        where: { tenantId: priceList.tenantId, status: PriceListStatus.active },
        data: { status: PriceListStatus.archived, validTo: closeDate },
      });

      return tx.priceList.update({
        where: { id },
        data: { status: PriceListStatus.active, validTo: null },
        include: { items: { orderBy: { serviceName: 'asc' } } },
      });
    });
  }

  async remove(id: string) {
    const priceList = await this.getById(id);
    if (priceList.status !== PriceListStatus.draft) {
      throw Object.assign(new Error('Można usunąć wyłącznie roboczą wersję cennika'), { statusCode: 409 });
    }
    await prisma.priceList.delete({ where: { id } });
    return { deleted: true };
  }
}

export const pricingService = new PricingService();
