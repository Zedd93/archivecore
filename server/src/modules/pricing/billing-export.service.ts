import { BillingEvent, BillingEventStatus, BillingPeriodStatus, Prisma } from '@prisma/client';
import * as XLSX from 'xlsx';
import { prisma } from '../../config/database';

type ExportEvent = Pick<BillingEvent,
  'id' | 'serviceCode' | 'serviceName' | 'unit' | 'quantity' | 'unitPrice' |
  'netAmount' | 'vatRate' | 'currency' | 'description' | 'occurredAt'
> & { order: { orderNumber: string } | null };

type SummaryLine = {
  serviceCode: string;
  serviceName: string;
  unit: string;
  unitPrice: Prisma.Decimal;
  vatRate: Prisma.Decimal;
  currency: string;
  quantity: Prisma.Decimal;
  netAmount: Prisma.Decimal;
  vatAmount: Prisma.Decimal;
};

function money(value: Prisma.Decimal) {
  return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

function appendSheet(workbook: XLSX.WorkBook, name: string, rows: (string | number)[][]) {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((value, column) => {
      widths[column] = Math.max(widths[column] || 14, Math.min(65, String(value ?? '').length + 2));
    });
  }
  sheet['!cols'] = widths.map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(workbook, sheet, name);
}

function formatNumbers(sheet: XLSX.WorkSheet, firstRow: number, columns: number[]) {
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
  for (let row = firstRow; row <= range.e.r; row++) {
    for (const column of columns) {
      const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
      if (cell?.t === 'n') cell.z = '#,##0.00';
    }
  }
}

export function buildBillingWorkbook(
  tenant: { name: string; shortCode: string; nip: string | null; address: string | null },
  month: string,
  closedAt: Date,
  events: ExportEvent[]
) {
  const groups = new Map<string, SummaryLine>();
  const detailRows: (string | number)[][] = [[
    'ID pozycji', 'Data operacji', 'Numer zlecenia', 'Opis', 'Kod usługi', 'Usługa',
    'Jednostka', 'Ilość', 'Cena jednostkowa netto', 'Wartość netto', 'VAT %',
    'Kwota VAT', 'Wartość brutto', 'Waluta',
  ]];

  let totalNet = new Prisma.Decimal(0);
  let totalVat = new Prisma.Decimal(0);

  for (const event of events) {
    if (!event.unitPrice || !event.netAmount) {
      throw Object.assign(new Error('Pozycja rozliczeniowa nie ma ceny'), { statusCode: 409 });
    }

    const vatAmount = money(event.netAmount.mul(event.vatRate).div(100));
    const key = JSON.stringify([
      event.serviceCode, event.serviceName, event.unit,
      event.unitPrice.toString(), event.vatRate.toString(), event.currency,
    ]);
    const group = groups.get(key) || {
      serviceCode: event.serviceCode,
      serviceName: event.serviceName,
      unit: event.unit,
      unitPrice: event.unitPrice,
      vatRate: event.vatRate,
      currency: event.currency,
      quantity: new Prisma.Decimal(0),
      netAmount: new Prisma.Decimal(0),
      vatAmount: new Prisma.Decimal(0),
    };
    group.quantity = group.quantity.plus(event.quantity);
    group.netAmount = group.netAmount.plus(event.netAmount);
    group.vatAmount = group.vatAmount.plus(vatAmount);
    groups.set(key, group);
    totalNet = totalNet.plus(event.netAmount);
    totalVat = totalVat.plus(vatAmount);

    detailRows.push([
      event.id,
      event.occurredAt.toISOString().slice(0, 10),
      event.order?.orderNumber || '',
      event.description || '',
      event.serviceCode,
      event.serviceName,
      event.unit,
      event.quantity.toNumber(),
      event.unitPrice.toNumber(),
      event.netAmount.toNumber(),
      event.vatRate.toNumber(),
      vatAmount.toNumber(),
      event.netAmount.plus(vatAmount).toNumber(),
      event.currency,
    ]);
  }

  const summaryRows: (string | number)[][] = [
    ['Zestawienie rozliczenia - dokument pomocniczy, nie faktura'],
    ['Klient', tenant.name],
    ['Kod klienta', tenant.shortCode],
    ['NIP', tenant.nip || ''],
    ['Adres', tenant.address || ''],
    ['Miesiąc', month],
    ['Zamknięto', closedAt.toISOString().slice(0, 10)],
    ['Liczba pozycji do rozliczenia', events.length],
    ['VAT liczony od każdej pozycji, następnie sumowany'],
    [],
    ['Kod usługi', 'Usługa', 'Jednostka', 'Cena jednostkowa netto', 'Ilość', 'VAT %', 'Netto', 'VAT', 'Brutto', 'Waluta'],
  ];

  for (const group of [...groups.values()].sort((a, b) => a.serviceName.localeCompare(b.serviceName, 'pl'))) {
    summaryRows.push([
      group.serviceCode,
      group.serviceName,
      group.unit,
      group.unitPrice.toNumber(),
      group.quantity.toNumber(),
      group.vatRate.toNumber(),
      group.netAmount.toNumber(),
      group.vatAmount.toNumber(),
      group.netAmount.plus(group.vatAmount).toNumber(),
      group.currency,
    ]);
  }
  summaryRows.push([]);
  summaryRows.push(['RAZEM', '', '', '', '', '', totalNet.toNumber(), totalVat.toNumber(), totalNet.plus(totalVat).toNumber(), 'PLN']);

  const workbook = XLSX.utils.book_new();
  appendSheet(workbook, 'Podsumowanie', summaryRows);
  appendSheet(workbook, 'Pozycje', detailRows);
  formatNumbers(workbook.Sheets.Podsumowanie, 11, [3, 4, 5, 6, 7, 8]);
  formatNumbers(workbook.Sheets.Pozycje, 1, [7, 8, 9, 10, 11, 12]);
  return Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
}

export class BillingExportService {
  async exportClosedPeriod(tenantId: string, month: string) {
    const periodStart = new Date(`${month}-01T00:00:00.000Z`);
    const period = await prisma.billingPeriod.findUnique({
      where: { tenantId_periodStart: { tenantId, periodStart } },
      include: { tenant: { select: { name: true, shortCode: true, nip: true, address: true } } },
    });
    if (!period || period.status !== BillingPeriodStatus.closed || !period.closedAt) {
      throw Object.assign(new Error('Eksport jest dostępny po zamknięciu miesiąca rozliczeniowego'), { statusCode: 409 });
    }

    const events = await prisma.billingEvent.findMany({
      where: {
        tenantId,
        billingPeriod: periodStart,
        status: BillingEventStatus.pending,
      },
      orderBy: [{ serviceCode: 'asc' }, { occurredAt: 'asc' }, { id: 'asc' }],
      include: { order: { select: { orderNumber: true } } },
    });
    const buffer = buildBillingWorkbook(period.tenant, month, period.closedAt, events);
    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '_');
    const tenantCode = period.tenant.shortCode.replace(/[^A-Za-z0-9_-]/g, '_') || tenantId;
    return {
      buffer,
      filename: `rozliczenie_${tenantCode}_${month}_${stamp}.xlsx`,
      periodId: period.id,
      eventCount: events.length,
    };
  }
}

export const billingExportService = new BillingExportService();
