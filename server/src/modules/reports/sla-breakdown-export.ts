import * as XLSX from 'xlsx';
import { ORDER_TYPE_LABELS, PRIORITY_LABELS } from '@archivecore/shared';
import type { ReportService } from './report.service';

type SlaBreakdown = Awaited<ReturnType<ReportService['getSlaBreakdown']>>;
type ExportFormat = 'xlsx' | 'csv';

function csvSafe(value: string | number): string | number {
  return typeof value === 'string' && /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value;
}

export function buildSlaBreakdownExport(report: SlaBreakdown, scope: 'tenant' | 'all', format: ExportFormat) {
  const totalRate = report.totals.completed
    ? Math.round((report.totals.completed - report.totals.breached) / report.totals.completed * 100)
    : '';
  const rows: Array<Array<string | number>> = [
    ['Raport SLA: klient, rodzaj zlecenia i priorytet'],
    ['Okres zakończonych zleceń', `${report.since.toISOString()} - ${report.asOf.toISOString()}`],
    ['Stan aktywnych zleceń na', report.asOf.toISOString()],
    ['Zakres', scope === 'all' ? 'Wszyscy klienci' : 'Wybrany klient'],
    ['Rodzaj zlecenia', report.orderType ? ORDER_TYPE_LABELS[report.orderType] || report.orderType : 'Wszystkie'],
    [],
    ['Klient', 'Rodzaj zlecenia', 'Priorytet', 'Zakończone', 'Po terminie', 'Aktywne po terminie', 'W terminie (%)'],
    ...report.data.map((row) => [
      row.tenantName,
      ORDER_TYPE_LABELS[row.orderType] || row.orderType,
      PRIORITY_LABELS[row.priority] || row.priority,
      row.completed,
      row.breached,
      row.activeOverdue,
      row.slaRate ?? '',
    ]),
    ['Razem', '', '', report.totals.completed, report.totals.breached, report.totals.activeOverdue, totalRate],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(format === 'csv' ? rows.map((row) => row.map(csvSafe)) : rows);
  sheet['!cols'] = [34, 22, 18, 15, 17, 24, 17].map((wch) => ({ wch }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'SLA');
  const timestamp = report.asOf.toISOString().replace(/[:.]/g, '-');

  if (format === 'csv') {
    return {
      buffer: Buffer.from('\uFEFF' + XLSX.utils.sheet_to_csv(sheet, { FS: ';' }), 'utf-8'),
      filename: `raport_sla_${timestamp}.csv`,
      contentType: 'text/csv; charset=utf-8',
    };
  }
  return {
    buffer: Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })),
    filename: `raport_sla_${timestamp}.xlsx`,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}
