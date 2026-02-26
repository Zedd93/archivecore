import { Request, Response, NextFunction } from 'express';
import { transferListService } from './transfer-list.service';
import { successResponse, paginatedResponse, errorResponse } from '../../utils/response';
import { parsePagination } from '../../utils/pagination';
import * as XLSX from 'xlsx';

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

      let workbook: XLSX.WorkBook;
      try {
        workbook = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
      } catch (parseErr: any) {
        return errorResponse(res, `Nie udało się odczytać pliku: ${parseErr.message}`, 400);
      }

      const sheetName = workbook.SheetNames[0];
      if (!sheetName) {
        return errorResponse(res, 'Plik nie zawiera żadnych arkuszy', 400);
      }
      const sheet = workbook.Sheets[sheetName];
      const rawRows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });

      if (rawRows.length === 0) {
        return errorResponse(res, 'Plik jest pusty lub nie zawiera danych', 400);
      }

      // Map Excel columns to our fields (supports Polish header names)
      const columnMap: Record<string, string> = {
        // Polish names (including common variations)
        'lp': '_ordinal',
        'lp.': '_ordinal',
        'l.p.': '_ordinal',
        'nr': '_ordinal',
        'znak teczki': 'folderSignature',
        'sygnatura': 'folderSignature',
        'sygn.': 'folderSignature',
        'tytuł teczki': 'folderTitle',
        'tytuł teczki lub tomu': 'folderTitle',
        'tytuł teczki (tomu)': 'folderTitle',
        'tytuł': 'folderTitle',
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
        'daty': '_dateRange',
        'kat. akt': 'categoryCode',
        'kat akt': 'categoryCode',
        'kat.': 'categoryCode',
        'kategoria': 'categoryCode',
        'kategoria akt': 'categoryCode',
        'kategoria archiwalna': 'categoryCode',
        'liczba teczek': 'folderCount',
        'ilość': 'folderCount',
        'ilość teczek': 'folderCount',
        'liczba': 'folderCount',
        'l. teczek': 'folderCount',
        'miejsce przechowywania': 'storageLocation',
        'miejsce przechowywania akt': 'storageLocation',
        'miejsce przechowywania akt w archiwum': 'storageLocation',
        'lokalizacja': 'storageLocation',
        'data zniszczenia': 'disposalOrTransferDate',
        'data zniszczenia lub przekazania': 'disposalOrTransferDate',
        'data zniszczenia lub przekazania do archiwum państwowego': 'disposalOrTransferDate',
        'data przekazania': 'disposalOrTransferDate',
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

      // Detect which columns map to which fields
      const firstRow = rawRows[0];
      const headerMap: Record<string, string> = {};
      for (const key of Object.keys(firstRow)) {
        const normalized = key.toLowerCase().trim().replace(/\s+/g, ' ').replace(/[.,]+$/, '');
        if (columnMap[normalized]) {
          headerMap[key] = columnMap[normalized];
        }
      }

      // If no columns matched, try to map by position (Lp, Znak teczki, Tytuł...)
      const fieldOrder = [
        'folderSignature', 'folderTitle', 'dateFrom', 'dateTo',
        'categoryCode', 'folderCount', 'storageLocation', 'disposalOrTransferDate',
      ];

      // Parse dates safely
      const parseDate = (val: any): string | null => {
        if (val === null || val === undefined || val === '') return null;
        // Handle Excel Date objects
        if (val instanceof Date) {
          if (isNaN(val.getTime())) return null;
          return val.toISOString().split('T')[0];
        }
        // Handle Excel serial numbers (number type)
        if (typeof val === 'number' && val > 1000 && val < 100000) {
          try {
            // Excel serial date: days since 1900-01-01 (with 1900 leap year bug)
            const date = new Date((val - 25569) * 86400 * 1000);
            if (!isNaN(date.getTime())) return date.toISOString().split('T')[0];
          } catch { /* fall through */ }
        }
        const s = String(val).trim();
        if (!s) return null;
        // Try YYYY-MM-DD
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
        // Try DD.MM.YYYY or DD/MM/YYYY
        const m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
        if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
        // Try YYYY
        if (/^\d{4}$/.test(s)) return `${s}-01-01`;
        // Try YYYY.MM or YYYY/MM
        const ym = s.match(/^(\d{4})[./](\d{1,2})$/);
        if (ym) return `${ym[1]}-${ym[2].padStart(2, '0')}-01`;
        return null;
      };

      // Parse "date range" column that combines from-to in one cell (e.g. "2020-2024" or "2020.01-2024.12")
      const parseDateRange = (val: any): { from: string | null; to: string | null } => {
        if (!val) return { from: null, to: null };
        const s = String(val).trim();
        // "2020-2024" or "2020 - 2024"
        const rangeMatch = s.match(/^(\d{4})\s*[-–—]\s*(\d{4})$/);
        if (rangeMatch) return { from: `${rangeMatch[1]}-01-01`, to: `${rangeMatch[2]}-12-31` };
        // More complex ranges
        const parts = s.split(/\s*[-–—]\s*/);
        if (parts.length === 2) {
          return { from: parseDate(parts[0]), to: parseDate(parts[1]) };
        }
        return { from: parseDate(s), to: null };
      };

      const items = rawRows.map((row: any, rowIndex: number) => {
        const mapped: any = {};

        if (Object.keys(headerMap).length > 0) {
          // Map by detected headers
          for (const [originalKey, fieldName] of Object.entries(headerMap)) {
            mapped[fieldName] = row[originalKey];
          }
        } else {
          // Map by column position (skip first column if it looks like Lp.)
          const values = Object.values(row);
          const startIdx = (typeof values[0] === 'number' || /^\d+$/.test(String(values[0]))) ? 1 : 0;
          fieldOrder.forEach((field, i) => {
            if (values[startIdx + i] !== undefined) {
              mapped[field] = values[startIdx + i];
            }
          });
        }

        // Handle combined date range column
        if (mapped._dateRange && !mapped.dateFrom && !mapped.dateTo) {
          const range = parseDateRange(mapped._dateRange);
          mapped.dateFrom = range.from;
          mapped.dateTo = range.to;
        }

        const folderSignature = String(mapped.folderSignature ?? '').trim();
        const folderTitle = String(mapped.folderTitle ?? '').trim();

        // Skip rows that are clearly empty or headers repeated in data
        if (!folderSignature && !folderTitle) return null;

        return {
          folderSignature: folderSignature || `Poz. ${rowIndex + 1}`,
          folderTitle: folderTitle || 'Bez tytułu',
          dateFrom: parseDate(mapped.dateFrom),
          dateTo: parseDate(mapped.dateTo),
          categoryCode: String(mapped.categoryCode ?? '').trim() || 'B10',
          folderCount: Math.max(1, parseInt(String(mapped.folderCount)) || 1),
          storageLocation: mapped.storageLocation ? String(mapped.storageLocation).trim() || null : null,
          disposalOrTransferDate: parseDate(mapped.disposalOrTransferDate),
          notes: mapped.notes ? String(mapped.notes).trim() || null : null,
        };
      }).filter((item: any) => item !== null);

      if (items.length === 0) {
        const detectedHeaders = Object.keys(headerMap);
        const hint = detectedHeaders.length > 0
          ? `Rozpoznano kolumny: ${detectedHeaders.join(', ')}, ale wszystkie wiersze są puste.`
          : `Nie rozpoznano nagłówków. Kolumny w pliku: ${Object.keys(firstRow).join(', ')}`;
        return errorResponse(res, `Nie udało się zaimportować żadnych pozycji. ${hint}`, 400);
      }

      const result = await transferListService.importItems(req.params.id, req.tenantId, items);
      return successResponse(res, result, 201);
    } catch (err: any) {
      next(err);
    }
  }
}

export const transferListController = new TransferListController();
