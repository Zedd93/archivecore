import { Request, Response, NextFunction } from 'express';
import { transferListService } from './transfer-list.service';
import { successResponse, paginatedResponse, errorResponse } from '../../utils/response';
import { parsePagination } from '../../utils/pagination';
import * as XLSX from 'xlsx';

const TRANSFER_LIST_COLUMN_MAP: Record<string, string> = {
  // Polish names (including common variations)
  'lp': '_ordinal',
  'l p': '_ordinal',
  'nr': '_ordinal',
  'znak teczki': 'folderSignature',
  'sygnatura': 'folderSignature',
  'sygn': 'folderSignature',
  'tytuł teczki': 'folderTitle',
  'tytul teczki': 'folderTitle',
  'tytuł teczki lub tomu': 'folderTitle',
  'tytul teczki lub tomu': 'folderTitle',
  'tytuł teczki tomu': 'folderTitle',
  'tytul teczki tomu': 'folderTitle',
  'tytuł': 'folderTitle',
  'tytul': 'folderTitle',
  'nazwa': 'folderTitle',
  'data od': 'dateFrom',
  'daty skrajne od': 'dateFrom',
  'od': 'dateFrom',
  'roczniki od': 'dateFrom',
  'data do': 'dateTo',
  'daty skrajne do': 'dateTo',
  'do': 'dateTo',
  'roczniki do': 'dateTo',
  'daty skrajne': '_dateRange',
  'daty skrajne od do': '_dateRange',
  'daty skrajne oddo': '_dateRange',
  'daty': '_dateRange',
  'kat akt': 'categoryCode',
  'kat': 'categoryCode',
  'kategoria': 'categoryCode',
  'kategoria akt': 'categoryCode',
  'kategoria archiwalna': 'categoryCode',
  'liczba teczek': 'folderCount',
  'ilość': 'folderCount',
  'ilosc': 'folderCount',
  'ilość teczek': 'folderCount',
  'ilosc teczek': 'folderCount',
  'liczba': 'folderCount',
  'l teczek': 'folderCount',
  'miejsce przechowywania': 'storageLocation',
  'miejsce przechowywania akt': 'storageLocation',
  'miejsce przechowywania akt w archiwum': 'storageLocation',
  'lokalizacja': 'storageLocation',
  'data zniszczenia': 'disposalOrTransferDate',
  'data zniszczenia lub przekazania': 'disposalOrTransferDate',
  'data zniszczenia lub przekazania do archiwum państwowego': 'disposalOrTransferDate',
  'data zniszczenia lub przekazania do archiwum panstwowego': 'disposalOrTransferDate',
  'data przekazania': 'disposalOrTransferDate',
  'numer kartonu': 'boxNumber',
  'nr kartonu': 'boxNumber',
  'karton': 'boxNumber',
  'box number': 'boxNumber',
  'uwagi': 'notes',
  'notatki': 'notes',
  // English names (fallback)
  'folder signature': 'folderSignature',
  'signature': 'folderSignature',
  'folder title': 'folderTitle',
  'title': 'folderTitle',
  'date from': 'dateFrom',
  'date to': 'dateTo',
  'category': 'categoryCode',
  'category code': 'categoryCode',
  'folder count': 'folderCount',
  'count': 'folderCount',
  'storage location': 'storageLocation',
  'location': 'storageLocation',
  'disposal date': 'disposalOrTransferDate',
  'transfer date': 'disposalOrTransferDate',
  'notes': 'notes',
};

function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/(?<=\p{L})[-‑‐](?=\p{L})/gu, '')
    .replace(/[–—-]+/g, ' ')
    .replace(/[.,:;]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getWorksheetRows(sheet: XLSX.WorkSheet): any[][] {
  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    blankrows: true,
    raw: true,
  }) as any[][];
}

function detectHeaderRow(rows: any[][]): { headerIndex: number; headerMap: Record<number, string> } | null {
  for (let headerIndex = 0; headerIndex < rows.length; headerIndex++) {
    const headerMap: Record<number, string> = {};
    const fields = new Set<string>();

    rows[headerIndex].forEach((cell, columnIndex) => {
      const field = TRANSFER_LIST_COLUMN_MAP[normalizeHeader(cell)];
      if (field) {
        headerMap[columnIndex] = field;
        fields.add(field);
      }
    });

    if (fields.has('folderSignature') && fields.has('folderTitle') && fields.has('categoryCode')) {
      return { headerIndex, headerMap };
    }
  }

  return null;
}

function selectTransferListSheet(workbook: XLSX.WorkBook) {
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = getWorksheetRows(sheet);
    if (rows.length === 0) continue;
    const header = detectHeaderRow(rows);
    if (header) return { sheetName, rows, ...header };
  }

  return null;
}

function parseDate(val: any): string | null {
  if (val === null || val === undefined || val === '') return null;
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    return val.toISOString().split('T')[0];
  }
  if (typeof val === 'number' && Number.isInteger(val) && val >= 1000 && val <= 3000) {
    return `${val}-01-01`;
  }
  if (typeof val === 'number' && val > 1000 && val < 100000) {
    try {
      const date = new Date((val - 25569) * 86400 * 1000);
      if (!isNaN(date.getTime())) return date.toISOString().split('T')[0];
    } catch { /* fall through */ }
  }

  const s = String(val).trim();
  if (!s || /^brak\s+dat$/i.test(s)) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if (/^\d{4}$/.test(s)) return `${s}-01-01`;
  const ym = s.match(/^(\d{4})[./](\d{1,2})$/);
  if (ym) return `${ym[1]}-${ym[2].padStart(2, '0')}-01`;
  return null;
}

function parseDateRange(val: any): { from: string | null; to: string | null } {
  if (val === null || val === undefined || val === '') return { from: null, to: null };
  const s = String(val).trim();
  if (!s || /^brak\s+dat$/i.test(s)) return { from: null, to: null };

  const year = s.match(/^(\d{4})$/);
  if (year) return { from: `${year[1]}-01-01`, to: `${year[1]}-12-31` };

  const yearRange = s.match(/^(\d{4})\s*[-–—]\s*(\d{4})$/);
  if (yearRange) return { from: `${yearRange[1]}-01-01`, to: `${yearRange[2]}-12-31` };

  const parts = s.split(/\s*[-–—]\s*/);
  if (parts.length === 2) {
    return { from: parseDate(parts[0]), to: parseDate(parts[1]) };
  }

  return { from: parseDate(s), to: null };
}

function isColumnNumberingRow(mapped: any): boolean {
  return /^\d+$/.test(String(mapped.folderSignature ?? '').trim())
    && /^\d+$/.test(String(mapped.folderTitle ?? '').trim())
    && /^\d+$/.test(String(mapped.categoryCode ?? '').trim());
}

export function parseTransferListImport(buffer: Buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const selected = selectTransferListSheet(workbook);
  if (!selected) {
    throw Object.assign(new Error('Nie rozpoznano arkusza ze spisem zdawczo-odbiorczym. Oczekiwane nagłówki to m.in. "Znak teczki", "Tytuł teczki lub tomu", "Kat. akt".'), { statusCode: 400 });
  }

  const items = selected.rows.slice(selected.headerIndex + 1).map((row, rowIndex) => {
    const mapped: any = {};
    for (const [columnIndex, fieldName] of Object.entries(selected.headerMap)) {
      mapped[fieldName] = row[Number(columnIndex)];
    }

    if (isColumnNumberingRow(mapped)) return null;

    if (mapped._dateRange && !mapped.dateFrom && !mapped.dateTo) {
      const range = parseDateRange(mapped._dateRange);
      mapped.dateFrom = range.from;
      mapped.dateTo = range.to;
    }

    const folderSignature = String(mapped.folderSignature ?? '').trim();
    const folderTitle = String(mapped.folderTitle ?? '').trim();

    if (!folderSignature && !folderTitle) return null;
    if (normalizeHeader(folderSignature) === 'znak teczki' || normalizeHeader(folderTitle).startsWith('tytuł teczki')) return null;

    const boxNumber = String(mapped.boxNumber ?? '').trim();

    return {
      folderSignature: folderSignature || `Poz. ${rowIndex + 1}`,
      folderTitle: folderTitle || 'Bez tytułu',
      dateFrom: parseDate(mapped.dateFrom),
      dateTo: parseDate(mapped.dateTo),
      categoryCode: String(mapped.categoryCode ?? '').trim() || 'B10',
      folderCount: Math.max(1, parseInt(String(mapped.folderCount), 10) || 1),
      storageLocation: mapped.storageLocation ? String(mapped.storageLocation).trim() || null : null,
      disposalOrTransferDate: parseDate(mapped.disposalOrTransferDate),
      boxNumber: boxNumber || null,
      notes: mapped.notes ? String(mapped.notes).trim() || null : null,
    };
  }).filter((item: any) => item !== null);

  return {
    sheetName: selected.sheetName,
    headerRow: selected.headerIndex + 1,
    items,
  };
}

export class TransferListController {
  // ─── Lists ─────────────────────────────────────────────
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const { skip, take, page, limit } = parsePagination(req.query as any);
      const { data, total } = await transferListService.list(req.tenantId, req.query, skip, take);
      return paginatedResponse(res, data, total, page, limit);
    } catch (err) { next(err); }
  }

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const list = await transferListService.getById(req.params.id, req.tenantId);
      return successResponse(res, list);
    } catch (err) { next(err); }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const list = await transferListService.create(req.body, req.tenantId, req.user!.userId);
      return successResponse(res, list, 201);
    } catch (err) { next(err); }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const list = await transferListService.update(req.params.id, req.tenantId, req.body);
      return successResponse(res, list);
    } catch (err) { next(err); }
  }

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      await transferListService.delete(req.params.id, req.tenantId);
      return successResponse(res, { message: 'Spis został usunięty' });
    } catch (err) { next(err); }
  }

  async changeStatus(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const { status } = req.body;
      const list = await transferListService.changeStatus(req.params.id, req.tenantId, status);
      return successResponse(res, list);
    } catch (err) { next(err); }
  }

  // ─── Items ─────────────────────────────────────────────
  async getItems(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const { skip, take, page, limit } = parsePagination(req.query as any);
      const { data, total } = await transferListService.getItems(
        req.params.id, req.tenantId, req.query, skip, take
      );
      return paginatedResponse(res, data, total, page, limit);
    } catch (err) { next(err); }
  }

  async addItem(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const item = await transferListService.addItem(req.params.id, req.tenantId, req.user!.userId, req.body);
      return successResponse(res, item, 201);
    } catch (err) { next(err); }
  }

  async updateItem(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const item = await transferListService.updateItem(
        req.params.id, req.params.itemId, req.tenantId, req.user!.userId, req.body
      );
      return successResponse(res, item);
    } catch (err) { next(err); }
  }

  async deleteItem(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      await transferListService.deleteItem(req.params.id, req.params.itemId, req.tenantId);
      return successResponse(res, { message: 'Pozycja usunięta' });
    } catch (err) { next(err); }
  }

  // ─── Bulk operations on items ──────────────────────────
  async bulkDeleteItems(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const { itemIds } = req.body;
      if (!Array.isArray(itemIds) || itemIds.length === 0) {
        return errorResponse(res, 'Wymagana lista identyfikatorów pozycji', 400);
      }
      const result = await transferListService.bulkDeleteItems(req.params.id, req.tenantId, itemIds);
      return successResponse(res, result);
    } catch (err) { next(err); }
  }

  async bulkAssignBox(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const { itemIds, boxNumber } = req.body;
      if (!Array.isArray(itemIds) || itemIds.length === 0) {
        return errorResponse(res, 'Wymagana lista identyfikatorów pozycji', 400);
      }
      const result = await transferListService.bulkAssignBox(
        req.params.id, req.tenantId, req.user!.userId, itemIds, boxNumber ?? null
      );
      return successResponse(res, result);
    } catch (err) { next(err); }
  }

  // ─── Import from Excel/CSV ─────────────────────────────
  async importFile(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      if (!req.file) return errorResponse(res, 'Nie przesłano pliku', 400);

      let parsed: ReturnType<typeof parseTransferListImport>;
      try {
        parsed = parseTransferListImport(req.file.buffer);
      } catch (parseErr: any) {
        return errorResponse(res, `Nie udało się odczytać pliku: ${parseErr.message}`, 400);
      }

      const items = parsed.items;

      if (items.length === 0) {
        return errorResponse(res, `Rozpoznano arkusz "${parsed.sheetName}" i nagłówki w wierszu ${parsed.headerRow}, ale nie znaleziono żadnych pozycji do importu.`, 400);
      }

      const result = await transferListService.importItems(req.params.id, req.tenantId, req.user!.userId, items);
      return successResponse(res, result, 201);
    } catch (err: any) {
      next(err);
    }
  }
}

export const transferListController = new TransferListController();
