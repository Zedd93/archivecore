import { Request, Response, NextFunction } from 'express';
import { transferListService } from './transfer-list.service';
import { successResponse, paginatedResponse, errorResponse } from '../../utils/response';
import { parsePagination } from '../../utils/pagination';
import { parseTransferListImport } from './transfer-list-import.parser';

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
