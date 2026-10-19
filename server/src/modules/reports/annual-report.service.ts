import PDFDocument from 'pdfkit';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { currentWarsawYear, getAccessionLedgerAnnualSummary, reportYearRange } from './accession-ledger.service';
import { reportFontPath } from './monthly-report.service';
import { ORDER_TYPE_LABELS } from '@archivecore/shared';

export function parseReportYear(value: unknown, now = new Date()): number | null {
  if (typeof value !== 'string' || !/^\d{4}$/.test(value)) return null;
  const year = Number(value);
  return year >= 2000 && year <= currentWarsawYear(now) ? year : null;
}

export async function getAnnualReport(tenantId: string, year: number, db = prisma, now = new Date()) {
  if (!Number.isInteger(year) || year < 2000 || year > currentWarsawYear(now)) {
    throw Object.assign(new Error('Nieprawidłowy rok sprawozdania'), { statusCode: 400 });
  }
  const range = reportYearRange(year);
  const annualRange = { gte: range.start, lt: range.end };
  return db.$transaction(async (tx) => {
    const [tenant, ledger, newFolders, newHrFolders, createdOrders, completedOrders, inventorySessions,
      currentBoxes, currentFolders, currentHrFolders] = await Promise.all([
      tx.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }),
      getAccessionLedgerAnnualSummary(tenantId, year, tx),
      tx.folder.count({ where: { tenantId, createdAt: annualRange } }),
      tx.hRFolder.count({ where: { tenantId, createdAt: annualRange } }),
      tx.order.groupBy({ by: ['orderType'], where: { tenantId, createdAt: annualRange }, _count: true }),
      tx.order.count({ where: { tenantId, completedAt: annualRange } }),
      tx.inventorySession.count({ where: { tenantId, status: 'completed', finishedAt: annualRange } }),
      tx.box.count({ where: { tenantId, deletedAt: null, status: { not: 'disposed' } } }),
      tx.folder.count({ where: { tenantId, status: { not: 'disposed' } } }),
      tx.hRFolder.count({ where: { tenantId, disposalStatus: { not: 'disposed' } } }),
    ]);
    if (!tenant) throw Object.assign(new Error('Nie znaleziono klienta'), { statusCode: 404 });

    return {
      tenantName: tenant.name,
      year,
      generatedAt: now,
      ledger,
      activity: {
        newFolders,
        newHrFolders,
        createdOrders: createdOrders.map((row) => ({ type: row.orderType, count: row._count })),
        completedOrders,
        inventorySessions,
      },
      current: { boxes: currentBoxes, folders: currentFolders, hrFolders: currentHrFolders },
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20_000 });
}

export type AnnualReport = Awaited<ReturnType<typeof getAnnualReport>>;

export function buildAnnualReportPdf(report: AnnualReport): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 44, info: {
      Title: `Sprawozdanie roczne archiwum ${report.year}`, Author: 'ArchiveCore',
    } });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.registerFont('report', reportFontPath()).font('report');

    const line = (label: string, value: string | number) => {
      doc.fontSize(10).fillColor('#1f2937').text(`${label}: ${value}`, { paragraphGap: 4 });
    };
    const heading = (label: string) => {
      doc.moveDown(0.45).fontSize(14).fillColor('#155e75').text(label, { paragraphGap: 6 });
    };

    doc.fontSize(20).fillColor('#123047').text('Sprawozdanie roczne archiwum');
    doc.moveDown(0.2).fontSize(11).fillColor('#374151').text(report.tenantName);
    line('Rok operacji', report.year);
    line('Wygenerowano', report.generatedAt.toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' }));

    heading('Ruch zasobu');
    line('Nabytki kartonów', report.ledger.acquisitions);
    line('Ubytki kartonów (zakończone brakowania)', report.ledger.disposals);
    doc.fontSize(9).fillColor('#6b7280').text('Nabytki obejmują kartony utworzone na półce i potwierdzone przyjęcia. Przeniesienia nie są liczone ponownie.');

    heading('Operacje w roku');
    line('Dodane teczki', report.activity.newFolders);
    line('Dodane teczki akt osobowych', report.activity.newHrFolders);
    line('Utworzone zlecenia', report.activity.createdOrders.reduce((sum, row) => sum + row.count, 0));
    line('Zakończone zlecenia', report.activity.completedOrders);
    line('Zakończone inwentaryzacje', report.activity.inventorySessions);
    if (report.activity.createdOrders.length) {
      doc.fontSize(9).fillColor('#6b7280').text(report.activity.createdOrders
        .map((row) => `${ORDER_TYPE_LABELS[row.type] ?? row.type}: ${row.count}`).join('  |  '));
    }

    const tableX = 48;
    const tableWidth = 496;
    const rowHeight = 17;
    if (doc.y + 35 + rowHeight * 13 > doc.page.height - doc.page.margins.bottom) doc.addPage();
    heading('Nabytki i ubytki w miesiącach');
    const drawRow = (month: string, acquisitions: string, disposals: string, shaded = false) => {
      const y = doc.y;
      if (shaded) doc.rect(tableX, y, tableWidth, rowHeight).fill('#f1f5f9');
      doc.fontSize(9).fillColor('#1f2937');
      doc.text(month, tableX + 8, y + 3, { width: 210, lineBreak: false });
      doc.text(acquisitions, tableX + 260, y + 3, { width: 90, align: 'right', lineBreak: false });
      doc.text(disposals, tableX + 390, y + 3, { width: 90, align: 'right', lineBreak: false });
      doc.y = y + rowHeight;
      doc.x = tableX;
    };
    drawRow('Miesiąc', 'Nabytki', 'Ubytki', true);
    for (const row of report.ledger.months) {
      const label = new Intl.DateTimeFormat('pl-PL', { month: 'long', timeZone: 'Europe/Warsaw' })
        .format(new Date(Date.UTC(report.year, row.month - 1, 15)));
      drawRow(label, String(row.acquisitions), String(row.disposals), row.month % 2 === 0);
    }

    if (doc.y + 130 > doc.page.height - doc.page.margins.bottom) doc.addPage();
    heading('Stan bieżący');
    doc.fontSize(9).fillColor('#6b7280').text('Stan w dniu wygenerowania, a nie stan na koniec wskazanego roku.');
    line('Kartony niewybrakowane', report.current.boxes);
    line('Teczki niewybrakowane', report.current.folders);
    line('Akta osobowe niewybrakowane', report.current.hrFolders);

    doc.moveDown(0.5).fontSize(8).fillColor('#6b7280').text(
      'Sprawozdanie opiera się na danych zapisanych w ArchiveCore. Starsze operacje bez potwierdzenia w systemie nie są odtwarzane automatycznie. Dane historyczne mogą wymagać weryfikacji z dokumentacją papierową.',
    );
    doc.end();
  });
}
