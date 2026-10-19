import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { ORDER_TYPE_LABELS } from '@archivecore/shared';
import { getAccessionLedgerMonthSummary, reportMonthRange } from './accession-ledger.service';

export function parseReportMonth(value: unknown, now = new Date()) {
  if (typeof value !== 'string' || !/^(20\d{2})-(0[1-9]|1[0-2])$/.test(value)) return null;
  const [year, month] = value.split('-').map(Number);
  const { start, end } = reportMonthRange(year, month);
  const currentParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit',
  }).formatToParts(now);
  const currentYear = Number(currentParts.find((part) => part.type === 'year')?.value);
  const currentMonth = Number(currentParts.find((part) => part.type === 'month')?.value);
  if (year > currentYear || (year === currentYear && month > currentMonth)) return null;
  return { month: value, start, end };
}

export async function getMonthlyReport(tenantId: string, month: string, includeBilling: boolean, db = prisma, now = new Date()) {
  const period = parseReportMonth(month, now);
  if (!period) throw Object.assign(new Error('Nieprawidłowy miesiąc raportu'), { statusCode: 400 });

  const generatedAt = now;
  const nextYear = new Date(generatedAt);
  nextYear.setUTCFullYear(nextYear.getUTCFullYear() + 1);
  const monthlyRange = { gte: period.start, lt: period.end };
  const upcomingRange = { gte: generatedAt, lt: nextYear };

  return db.$transaction(async (tx) => {
    const [tenant, boxes, folders, hrFolders, ledger, newFolders, newHrFolders, createdOrders,
      completedOrders, slaOrders, inventorySessions, dueBoxes, dueHrFolders, billing] = await Promise.all([
      tx.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }),
      tx.box.count({ where: { tenantId, deletedAt: null, status: { not: 'disposed' } } }),
      tx.folder.count({ where: { tenantId, status: { not: 'disposed' } } }),
      tx.hRFolder.count({ where: { tenantId, disposalStatus: { not: 'disposed' } } }),
      getAccessionLedgerMonthSummary(tenantId, Number(month.slice(0, 4)), Number(month.slice(5, 7)), tx),
      tx.folder.count({ where: { tenantId, createdAt: monthlyRange } }),
      tx.hRFolder.count({ where: { tenantId, createdAt: monthlyRange } }),
      tx.order.groupBy({ by: ['orderType'], where: { tenantId, createdAt: monthlyRange }, _count: true }),
      tx.order.count({ where: { tenantId, completedAt: monthlyRange } }),
      tx.order.findMany({
        where: { tenantId, completedAt: monthlyRange, slaDeadline: { not: null } },
        select: { completedAt: true, slaDeadline: true },
      }),
      tx.inventorySession.count({ where: { tenantId, status: 'completed', finishedAt: monthlyRange } }),
      tx.box.count({ where: { tenantId, deletedAt: null, status: { not: 'disposed' }, retentionDate: upcomingRange } }),
      tx.hRFolder.count({ where: { tenantId, disposalStatus: 'active', retentionEndDate: upcomingRange, retentionBasis: { not: 'needs_review' }, litigationHold: false } }),
      includeBilling
        ? tx.billingEvent.groupBy({
          by: ['status', 'currency'],
          where: { tenantId, billingPeriod: monthlyRange },
          _count: true,
          _sum: { netAmount: true },
        })
        : Promise.resolve(null),
    ]);

    if (!tenant) throw Object.assign(new Error('Nie znaleziono tenanta'), { statusCode: 404 });

    return {
      tenantName: tenant.name,
      month,
      generatedAt,
      current: { boxes, folders, hrFolders },
      activity: {
        acquisitions: ledger.acquisitions,
        disposals: ledger.disposals,
        newFolders,
        newHrFolders,
        createdOrders: createdOrders.map((row) => ({ type: row.orderType, count: row._count })),
        completedOrders,
        inventorySessions,
        sla: {
          total: slaOrders.length,
          onTime: slaOrders.filter((order) => order.completedAt && order.slaDeadline && order.completedAt <= order.slaDeadline).length,
        },
      },
      upcoming: { boxes: dueBoxes, hrFolders: dueHrFolders },
      billing: billing?.map((row) => ({
        status: row.status,
        currency: row.currency,
        count: row._count,
        netAmount: row._sum.netAmount?.toFixed(2) ?? null,
      })) ?? null,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20_000 });
}

export type MonthlyReport = Awaited<ReturnType<typeof getMonthlyReport>>;

export function reportFontPath() {
  const candidates = [
    path.resolve(__dirname, '..', '..', 'assets', 'fonts', 'STIXTwoText.ttf'),
    path.resolve(process.cwd(), 'server', 'src', 'assets', 'fonts', 'STIXTwoText.ttf'),
    path.resolve(process.cwd(), 'src', 'assets', 'fonts', 'STIXTwoText.ttf'),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error('Nie znaleziono czcionki raportu');
  return found;
}

export function buildMonthlyReportPdf(report: MonthlyReport): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Raport miesięczny ${report.month}`, Author: 'ArchiveCore' } });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.registerFont('report', reportFontPath()).font('report');

    const line = (label: string, value: string | number) => {
      doc.fontSize(11).fillColor('#1f2937').text(`${label}: ${value}`, { paragraphGap: 5 });
    };
    const heading = (label: string) => {
      doc.moveDown(0.7).fontSize(15).fillColor('#155e75').text(label, { paragraphGap: 8 });
    };

    doc.fontSize(21).fillColor('#123047').text('Raport miesięczny archiwum');
    doc.moveDown(0.35).fontSize(12).fillColor('#374151').text(report.tenantName);
    line('Miesiąc operacji', report.month);
    line('Wygenerowano', report.generatedAt.toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' }));

    heading('Stan zasobu');
    doc.fontSize(9).fillColor('#6b7280').text('Stan bieżący w dniu wygenerowania, nie historyczny stan na koniec miesiąca.');
    line('Kartony (bez usuniętych i wybrakowanych)', report.current.boxes);
    line('Teczki (bez wybrakowanych)', report.current.folders);
    line('Akta osobowe (bez wybrakowanych)', report.current.hrFolders);

    heading('Ruch zasobu w wybranym miesiącu');
    line('Nabytki kartonów', report.activity.acquisitions);
    line('Ubytki kartonów (zakończone brakowania)', report.activity.disposals);
    doc.fontSize(9).fillColor('#6b7280').text('Nabytki obejmują kartony utworzone na półce i potwierdzone przyjęcia. Przeniesienia nie są liczone ponownie.');

    heading('Pozostałe operacje w wybranym miesiącu');
    line('Dodane teczki', report.activity.newFolders);
    line('Dodane teczki akt osobowych', report.activity.newHrFolders);
    const createdTotal = report.activity.createdOrders.reduce((sum, row) => sum + row.count, 0);
    line('Utworzone zlecenia', createdTotal);
    for (const row of report.activity.createdOrders) line(`  ${ORDER_TYPE_LABELS[row.type] ?? row.type}`, row.count);
    line('Zlecenia zakończone', report.activity.completedOrders);
    line('Zakończone inwentaryzacje', report.activity.inventorySessions);
    line('Zakończone w terminie (ze zdefiniowanym SLA)', `${report.activity.sla.onTime}/${report.activity.sla.total}`);

    doc.fontSize(8).fillColor('#6b7280').text('Starsze operacje bez zapisanego potwierdzenia w systemie mogą nie być ujęte w ruchu kartonów.');

    heading('Terminy retencji w ciągu 12 miesięcy');
    doc.fontSize(9).fillColor('#6b7280').text('Liczone od daty wygenerowania raportu; kartony i akta osobowe są wykazane osobno.');
    line('Kartony', report.upcoming.boxes);
    line('Akta osobowe', report.upcoming.hrFolders);

    heading('Koszty');
    if (report.billing === null) {
      doc.fontSize(10).fillColor('#6b7280').text('Brak uprawnienia do podglądu rozliczeń.');
    } else if (report.billing.length === 0) {
      doc.fontSize(10).fillColor('#6b7280').text('Brak zdarzeń rozliczeniowych dla tego miesiąca.');
    } else {
      doc.fontSize(9).fillColor('#6b7280').text('Bieżący stan rozliczeń za wybrany miesiąc. Kwoty netto nie są fakturą. Pozycje bez ceny i wyłączone nie wchodzą do sumy.');
      const labels: Record<string, string> = { pending: 'Do rozliczenia', invoiced: 'Zafakturowane', unpriced: 'Bez ceny', excluded: 'Wyłączone' };
      const totals = new Map<string, Prisma.Decimal>();
      for (const row of report.billing) {
        const billable = row.status === 'pending' || row.status === 'invoiced';
        if (billable && row.netAmount) {
          totals.set(row.currency, (totals.get(row.currency) ?? new Prisma.Decimal(0)).add(row.netAmount));
        }
        line(`${labels[row.status] ?? row.status} (${row.count})`, billable && row.netAmount ? `${row.netAmount} ${row.currency} netto` : 'bez naliczenia');
      }
      for (const [currency, amount] of totals) line(`Razem koszty ${currency}`, `${amount.toFixed(2)} ${currency} netto`);
    }

    doc.end();
  });
}
