import { BillingEventStatus, BillingPeriodStatus } from '@prisma/client';
import { prisma } from '../../config/database';

function conflict(message: string) {
  return Object.assign(new Error(message), { statusCode: 409 });
}

export class BillingInvoiceService {
  async confirmInvoice(tenantId: string, month: string, invoiceNumber: string, userId: string) {
    const [year, monthIndex] = month.split('-').map(Number);
    const periodStart = new Date(Date.UTC(year, monthIndex - 1, 1));
    const normalizedNumber = invoiceNumber.trim();

    return prisma.$transaction(async (tx) => {
      const period = await tx.billingPeriod.findUnique({
        where: { tenantId_periodStart: { tenantId, periodStart } },
      });
      if (!period || period.status !== BillingPeriodStatus.closed) {
        throw conflict('Najpierw zamknij miesiąc rozliczeniowy');
      }
      if (period.invoiceNumber || period.invoicedAt) {
        if (period.invoiceNumber === normalizedNumber && period.invoicedAt) {
          return { id: period.id, invoiceNumber: period.invoiceNumber, invoicedAt: period.invoicedAt, updatedEvents: 0 };
        }
        throw conflict('Miesiąc został już przypisany do innej faktury');
      }

      const eventWhere = { tenantId, billingPeriod: periodStart };
      const [pending, unpriced, invoiced] = await Promise.all([
        tx.billingEvent.count({ where: { ...eventWhere, status: BillingEventStatus.pending } }),
        tx.billingEvent.count({ where: { ...eventWhere, status: BillingEventStatus.unpriced } }),
        tx.billingEvent.count({ where: { ...eventWhere, status: BillingEventStatus.invoiced } }),
      ]);
      if (unpriced > 0) throw conflict('Nie można potwierdzić faktury: część pozycji nie ma ceny');
      if (invoiced > 0) throw conflict('Część pozycji jest już oznaczona jako zafakturowana');
      if (pending === 0) throw conflict('Brak pozycji do oznaczenia jako zafakturowane');

      const invoicedAt = new Date();
      const claimed = await tx.billingPeriod.updateMany({
        where: { id: period.id, status: BillingPeriodStatus.closed, invoiceNumber: null, invoicedAt: null },
        data: { invoiceNumber: normalizedNumber, invoicedAt, invoicedById: userId },
      });
      if (claimed.count !== 1) throw conflict('Miesiąc został już przypisany do faktury');

      const updated = await tx.billingEvent.updateMany({
        where: { ...eventWhere, status: BillingEventStatus.pending },
        data: { status: BillingEventStatus.invoiced },
      });
      if (updated.count !== pending) throw conflict('Pozycje rozliczenia zmieniły się w trakcie potwierdzania faktury');

      await tx.auditLog.create({
        data: {
          tenantId,
          userId,
          action: 'billing.period.invoice',
          entityType: 'billing_period',
          entityId: period.id,
          newValues: { month, invoiceNumber: normalizedNumber, updatedEvents: updated.count },
        },
      });

      return { id: period.id, invoiceNumber: normalizedNumber, invoicedAt, updatedEvents: updated.count };
    });
  }
}

export const billingInvoiceService = new BillingInvoiceService();
