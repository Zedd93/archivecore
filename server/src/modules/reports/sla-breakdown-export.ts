import * as XLSX from 'xlsx';
import { ORDER_TYPE_LABELS, PRIORITY_LABELS } from '@archivecore/shared';
import type { ReportService } from './report.service';

type SlaBreakdown = Awaited<ReturnType<ReportService['getSlaBreakdown']>>;
type SlaTenantTrends = Awaited<ReturnType<ReportService['getSlaTenantTrends']>>;
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
    ...(typeof report.slaTargetPercent === 'number' ? [['Cel SLA klienta (%)', report.slaTargetPercent]] : []),
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

export function buildSlaTenantTrendExport(report: SlaTenantTrends, format: ExportFormat) {
  const monthlyTotals = report.months.map((_, index) => report.data.reduce((sum, tenant) => ({
    completed: sum.completed + tenant.months[index].completed,
    breached: sum.breached + tenant.months[index].breached,
  }), { completed: 0, breached: 0 }));
  const completed = monthlyTotals.reduce((sum, month) => sum + month.completed, 0);
  const breached = monthlyTotals.reduce((sum, month) => sum + month.breached, 0);
  const rate = (total: number, late: number) => total ? Math.round((total - late) / total * 100) : '';
  const rows: Array<Array<string | number>> = [
    ['Porównanie terminowości SLA klientów'],
    ['Okres zakończonych zleceń', `${report.since.toISOString()} - ${report.asOf.toISOString()}`],
    ['Rodzaj zlecenia', report.orderType ? ORDER_TYPE_LABELS[report.orderType] || report.orderType : 'Wszystkie'],
    ['Uwaga', 'Pierwszy i ostatni miesiąc mogą być niepełne. Puste pola oznaczają brak zakończonych zleceń.'],
    [],
    ['Klient', ...report.months.flatMap((month) => [`${month} SLA (%)`, `${month} zleceń`]), 'Razem zleceń', 'Po terminie', 'W terminie (%)', 'Cel SLA (%)'],
    ...report.data.map((tenant) => [
      tenant.tenantName,
      ...tenant.months.flatMap((month) => [month.slaRate ?? '', month.completed]),
      tenant.completed,
      tenant.breached,
      tenant.slaRate ?? '',
      tenant.slaTargetPercent,
    ]),
    ['Razem', ...monthlyTotals.flatMap((month) => [rate(month.completed, month.breached), month.completed]), completed, breached, rate(completed, breached), ''],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(format === 'csv' ? rows.map((row) => row.map(csvSafe)) : rows);
  sheet['!cols'] = [{ wch: 34 }, ...report.months.flatMap(() => [{ wch: 16 }, { wch: 16 }]), { wch: 18 }, { wch: 16 }, { wch: 18 }, { wch: 16 }];
  const timestamp = report.asOf.toISOString().replace(/[:.]/g, '-');

  if (format === 'csv') {
    return {
      buffer: Buffer.from('\uFEFF' + XLSX.utils.sheet_to_csv(sheet, { FS: ';' }), 'utf-8'),
      filename: `raport_sla_klienci_${timestamp}.csv`,
      contentType: 'text/csv; charset=utf-8',
    };
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Klienci SLA');
  return {
    buffer: Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })),
    filename: `raport_sla_klienci_${timestamp}.xlsx`,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}
