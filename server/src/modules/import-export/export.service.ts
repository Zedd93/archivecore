import * as XLSX from 'xlsx';
import { prisma } from '../../config/database';
import { Prisma } from '@prisma/client';
import { BOX_STATUS_LABELS, ORDER_STATUS_LABELS, ORDER_TYPE_LABELS, PRIORITY_LABELS, EMPLOYMENT_STATUS_LABELS, DISPOSAL_STATUS_LABELS } from '@archivecore/shared';

// Transfer list statuses are not in shared constants — define locally
const TRANSFER_LIST_STATUS_LABELS: Record<string, string> = {
  draft: 'Szkic',
  confirmed: 'Zatwierdzony',
  archived: 'Zarchiwizowany',
};

// ─── Column definition for export ────────────────────────
interface ExportColumn {
  header: string;
  key: string;
  transform?: (value: any, row: any) => any;
}

// ─── Boxes export ────────────────────────────────────────
const BOX_COLUMNS: ExportColumn[] = [
  { header: 'Numer kartonu', key: 'boxNumber' },
  { header: 'Tytuł', key: 'title' },
  { header: 'Typ dokumentów', key: 'docType' },
  { header: 'Dział', key: 'department' },
  { header: 'Status', key: 'status', transform: (v) => BOX_STATUS_LABELS[v] || v },
  { header: 'Lokalizacja', key: 'location', transform: (_v, row) => row.location?.fullPath || '' },
  { header: 'Kod lokalizacji', key: 'locationCode', transform: (_v, row) => row.location?.code || '' },
  { header: 'Opis', key: 'description' },
  { header: 'Uwagi', key: 'notes' },
  { header: 'Kod QR', key: 'qrCode' },
  { header: 'Liczba teczek', key: 'foldersCount', transform: (_v, row) => row._count?.folders ?? 0 },
  { header: 'Liczba dokumentów', key: 'docsCount', transform: (_v, row) => row._count?.documents ?? 0 },
  { header: 'Data utworzenia', key: 'createdAt', transform: (v) => v ? new Date(v).toISOString().split('T')[0] : '' },
  { header: 'Data aktualizacji', key: 'updatedAt', transform: (v) => v ? new Date(v).toISOString().split('T')[0] : '' },
];

// ─── Orders export ───────────────────────────────────────
const ORDER_COLUMNS: ExportColumn[] = [
  { header: 'Numer zlecenia', key: 'orderNumber' },
  { header: 'Typ', key: 'orderType', transform: (v) => ORDER_TYPE_LABELS[v] || v },
  { header: 'Status', key: 'status', transform: (v) => ORDER_STATUS_LABELS[v] || v },
  { header: 'Priorytet', key: 'priority', transform: (v) => PRIORITY_LABELS[v] || v },
  { header: 'Zleceniodawca', key: 'requester', transform: (_v, row) => row.requester ? `${row.requester.firstName} ${row.requester.lastName}` : '' },
  { header: 'Zatwierdzający', key: 'approver', transform: (_v, row) => row.approver ? `${row.approver.firstName} ${row.approver.lastName}` : '' },
  { header: 'Realizujący', key: 'assignee', transform: (_v, row) => row.assignee ? `${row.assignee.firstName} ${row.assignee.lastName}` : '' },
  { header: 'Uwagi', key: 'notes' },
  { header: 'Termin SLA', key: 'slaDeadline', transform: (v) => v ? new Date(v).toISOString().replace('T', ' ').substring(0, 19) : '' },
  { header: 'Liczba pozycji', key: 'itemsCount', transform: (_v, row) => row._count?.items ?? 0 },
  { header: 'Data utworzenia', key: 'createdAt', transform: (v) => v ? new Date(v).toISOString().split('T')[0] : '' },
  { header: 'Data zakończenia', key: 'completedAt', transform: (v) => v ? new Date(v).toISOString().split('T')[0] : '' },
];

// ─── HR folders export ───────────────────────────────────
const HR_COLUMNS: ExportColumn[] = [
  { header: 'Imię', key: 'employeeFirstName' },
  { header: 'Nazwisko', key: 'employeeLastName' },
  { header: 'Nr ewidencyjny', key: 'employeeIdNumber' },
  { header: 'Status zatrudnienia', key: 'employmentStatus', transform: (v) => EMPLOYMENT_STATUS_LABELS[v] || v },
  { header: 'Dział', key: 'department' },
  { header: 'Stanowisko', key: 'position' },
  { header: 'Data zatrudnienia', key: 'employmentStart', transform: (v) => v ? new Date(v).toISOString().split('T')[0] : '' },
  { header: 'Data zakończenia', key: 'employmentEnd', transform: (v) => v ? new Date(v).toISOString().split('T')[0] : '' },
  { header: 'Okres retencji (lata)', key: 'retentionPeriod' },
  { header: 'Data końca retencji', key: 'retentionEndDate', transform: (v) => v ? new Date(v).toISOString().split('T')[0] : '' },
  { header: 'Status brakowania', key: 'disposalStatus', transform: (v) => DISPOSAL_STATUS_LABELS[v] || v },
  { header: 'Forma przechowywania', key: 'storageForm' },
  { header: 'Blokada sądowa', key: 'litigationHold', transform: (v) => v ? 'Tak' : 'Nie' },
  { header: 'Karton', key: 'box', transform: (_v, row) => row.box?.boxNumber || '' },
  { header: 'Liczba części', key: 'partsCount', transform: (_v, row) => row._count?.parts ?? 0 },
  { header: 'Data utworzenia', key: 'createdAt', transform: (v) => v ? new Date(v).toISOString().split('T')[0] : '' },
];

// ─── Transfer lists export ───────────────────────────────
const TRANSFER_LIST_COLUMNS: ExportColumn[] = [
  { header: 'Numer spisu', key: 'listNumber' },
  { header: 'Tytuł', key: 'title' },
  { header: 'Status', key: 'status', transform: (v) => TRANSFER_LIST_STATUS_LABELS[v] || v },
  { header: 'Jednostka przekazująca', key: 'transferringUnit' },
  { header: 'Jednostka przyjmująca', key: 'receivingUnit' },
  { header: 'Sporządził', key: 'createdBy', transform: (_v, row) => row.createdBy ? `${row.createdBy.firstName} ${row.createdBy.lastName}` : '' },
  { header: 'Liczba pozycji', key: 'itemsCount', transform: (_v, row) => row._count?.items ?? 0 },
  { header: 'Data utworzenia', key: 'createdAt', transform: (v) => v ? new Date(v).toISOString().split('T')[0] : '' },
  { header: 'Data aktualizacji', key: 'updatedAt', transform: (v) => v ? new Date(v).toISOString().split('T')[0] : '' },
];

// ─── Export service ──────────────────────────────────────
export class ExportService {
  private async getLocationAndDescendantIds(locationId: string, tenantId: string): Promise<string[]> {
    const locations = await prisma.location.findMany({
      where: {
        isActive: true,
        OR: [{ tenantId }, { tenantId: null }],
      },
      select: { id: true, parentId: true },
    });

    if (!locations.some(location => location.id === locationId)) {
      const err = new Error('Lokalizacja nie znaleziona');
      (err as any).statusCode = 404;
      throw err;
    }

    const childrenByParent = new Map<string, string[]>();
    for (const location of locations) {
      if (!location.parentId) continue;
      const children = childrenByParent.get(location.parentId) ?? [];
      children.push(location.id);
      childrenByParent.set(location.parentId, children);
    }

    const result: string[] = [];
    const stack = [locationId];
    while (stack.length > 0) {
      const currentId = stack.pop()!;
      result.push(currentId);
      stack.push(...(childrenByParent.get(currentId) ?? []));
    }

    return result;
  }

  private createTimestamp(date = new Date()): string {
    const pad = (value: number) => String(value).padStart(2, '0');
    return [
      date.getFullYear(),
      pad(date.getMonth() + 1),
      pad(date.getDate()),
    ].join('-') + '_' + [
      pad(date.getHours()),
      pad(date.getMinutes()),
      pad(date.getSeconds()),
    ].join('-');
  }

  private createFilename(prefix: string, ext: string): string {
    return `${prefix}_${this.createTimestamp()}.${ext}`;
  }

  /**
   * Generic method: convert rows → XLSX buffer or CSV string
   */
  private toWorkbook(rows: any[], columns: ExportColumn[]): XLSX.WorkBook {
    const sheetRows = rows.map(row =>
      columns.map(col => {
        const rawValue = row[col.key];
        const value = col.transform ? col.transform(rawValue, row) : rawValue;
        return value ?? '';
      })
    );

    const ws = XLSX.utils.aoa_to_sheet([
      columns.map(c => c.header),
      ...sheetRows,
    ]);
    ws['!ref'] = XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: sheetRows.length, c: Math.max(columns.length - 1, 0) },
    });

    // Auto-size columns (approximate)
    // Guard against empty rows — spreading an empty array into Math.max
    // returns -Infinity, which breaks column width calculation.
    const colWidths = columns.map((col, index) => {
      const maxLen = Math.max(
        col.header.length,
        ...(sheetRows.length > 0 ? sheetRows.map(r => String(r[index] ?? '').length) : [0])
      );
      return { wch: Math.min(maxLen + 2, 50) };
    });
    ws['!cols'] = colWidths;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Dane');
    return wb;
  }

  private generateBuffer(rows: any[], columns: ExportColumn[], format: 'xlsx' | 'csv'): Buffer {
    if (format === 'csv') {
      const wb = this.toWorkbook(rows, columns);
      const csvString = XLSX.utils.sheet_to_csv(wb.Sheets['Dane'], { FS: ';' });
      return Buffer.from('\uFEFF' + csvString, 'utf-8'); // BOM for Polish chars in Excel
    }

    const wb = this.toWorkbook(rows, columns);
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    return Buffer.from(buf);
  }

  // ─── BOXES ─────────────────────────────────────────────
  async exportBoxes(tenantId: string, filters: any, format: 'xlsx' | 'csv' = 'xlsx', department?: string): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
    const where: Prisma.BoxWhereInput = { tenantId };
    if (department) where.department = { equals: department, mode: 'insensitive' };
    if (filters.status) where.status = filters.status;
    if (filters.docType) where.docType = filters.docType;
    if (filters.locationId) {
      where.locationId = { in: await this.getLocationAndDescendantIds(String(filters.locationId), tenantId) };
    }
    if (filters.search) {
      where.OR = [
        { title: { contains: filters.search, mode: 'insensitive' } },
        { boxNumber: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const data = await prisma.box.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        location: { select: { fullPath: true, code: true } },
        _count: { select: { folders: true, documents: true } },
      },
    });

    const ext = format === 'csv' ? 'csv' : 'xlsx';
    const contentType = format === 'csv'
      ? 'text/csv; charset=utf-8'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    return {
      buffer: this.generateBuffer(data, BOX_COLUMNS, format),
      filename: this.createFilename('kartony', ext),
      contentType,
    };
  }

  // ─── ORDERS ────────────────────────────────────────────
  async exportOrders(tenantId: string, filters: any, format: 'xlsx' | 'csv' = 'xlsx'): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
    const where: Prisma.OrderWhereInput = { tenantId };
    if (filters.status) where.status = filters.status as any;
    if (filters.orderType) where.orderType = filters.orderType as any;
    if (filters.priority) where.priority = filters.priority as any;
    if (filters.search) {
      where.OR = [
        { orderNumber: { contains: filters.search, mode: 'insensitive' } },
        { notes: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const data = await prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        requester: { select: { firstName: true, lastName: true } },
        approver: { select: { firstName: true, lastName: true } },
        assignee: { select: { firstName: true, lastName: true } },
        _count: { select: { items: true } },
      },
    });

    const ext = format === 'csv' ? 'csv' : 'xlsx';
    const contentType = format === 'csv'
      ? 'text/csv; charset=utf-8'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    return {
      buffer: this.generateBuffer(data, ORDER_COLUMNS, format),
      filename: this.createFilename('zlecenia', ext),
      contentType,
    };
  }

  // ─── HR FOLDERS ────────────────────────────────────────
  async exportHR(tenantId: string, filters: any, format: 'xlsx' | 'csv' = 'xlsx'): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
    const where: Prisma.HRFolderWhereInput = { tenantId };
    if (filters.employmentStatus) where.employmentStatus = filters.employmentStatus as any;
    if (filters.department) where.department = { contains: filters.department, mode: 'insensitive' };
    if (filters.search) {
      where.OR = [
        { employeeFirstName: { contains: filters.search, mode: 'insensitive' } },
        { employeeLastName: { contains: filters.search, mode: 'insensitive' } },
        { department: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    // NOTE: PESEL is NOT exported (privacy)
    const data = await prisma.hRFolder.findMany({
      where,
      orderBy: { employeeLastName: 'asc' },
      select: {
        employeeFirstName: true,
        employeeLastName: true,
        employeeIdNumber: true,
        employmentStart: true,
        employmentEnd: true,
        employmentStatus: true,
        department: true,
        position: true,
        retentionPeriod: true,
        retentionEndDate: true,
        disposalStatus: true,
        storageForm: true,
        litigationHold: true,
        createdAt: true,
        box: { select: { boxNumber: true } },
        _count: { select: { parts: true } },
      },
    });

    const ext = format === 'csv' ? 'csv' : 'xlsx';
    const contentType = format === 'csv'
      ? 'text/csv; charset=utf-8'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    return {
      buffer: this.generateBuffer(data, HR_COLUMNS, format),
      filename: this.createFilename('akta_osobowe', ext),
      contentType,
    };
  }

  // ─── TRANSFER LISTS ────────────────────────────────────
  async exportTransferLists(tenantId: string, filters: any, format: 'xlsx' | 'csv' = 'xlsx'): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
    const where: Prisma.TransferListWhereInput = { tenantId };
    if (filters.status) where.status = filters.status;
    if (filters.search) {
      where.OR = [
        { title: { contains: filters.search, mode: 'insensitive' } },
        { listNumber: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const data = await prisma.transferList.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: { select: { firstName: true, lastName: true } },
        _count: { select: { items: true } },
      },
    });

    const ext = format === 'csv' ? 'csv' : 'xlsx';
    const contentType = format === 'csv'
      ? 'text/csv; charset=utf-8'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    return {
      buffer: this.generateBuffer(data, TRANSFER_LIST_COLUMNS, format),
      filename: this.createFilename('spisy_zo', ext),
      contentType,
    };
  }
}

export const exportService = new ExportService();
