import { Request, Response, NextFunction } from 'express';
import { retentionService } from './retention.service';
import { successResponse, errorResponse } from '../../utils/response';
import { buildDisposalConfirmationPdf, parseDisposalConfirmation } from './disposal-confirmation';
import { z } from 'zod';
import { disposalEvidenceService } from './disposal-evidence.service';

export class RetentionController {
  async listPolicies(req: Request, res: Response, next: NextFunction) {
    try {
      const policies = await retentionService.listPolicies(
        req.tenantId || null,
        req.user!,
        typeof req.query.tenantId === 'string' ? req.query.tenantId : undefined
      );
      return successResponse(res, policies);
    } catch (err) { next(err); }
  }

  async previewJrwa(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.file) return errorResponse(res, 'Nie załączono pliku JRWA', 400);
      if (!req.body.tenantId) return errorResponse(res, 'Wybierz tenanta', 400);
      const result = await retentionService.previewJrwa(
        req.file.buffer,
        req.file.originalname,
        req.body.tenantId,
        req.user!
      );
      return successResponse(res, result);
    } catch (err) { next(err); }
  }

  async listJrwaVersions(req: Request, res: Response, next: NextFunction) {
    try {
      const versions = await retentionService.listJrwaVersions(
        req.tenantId || null,
        req.user!,
        typeof req.query.tenantId === 'string' ? req.query.tenantId : undefined
      );
      return successResponse(res, versions);
    } catch (err) { next(err); }
  }

  async importJrwa(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.file) return errorResponse(res, 'Nie załączono pliku JRWA', 400);
      if (!req.body.tenantId) return errorResponse(res, 'Wybierz tenanta', 400);
      const result = await retentionService.importJrwa(
        req.file.buffer,
        req.file.originalname,
        req.body.tenantId,
        req.user!,
        req.body.label,
        req.body.validFrom
      );
      return successResponse(res, result, 201);
    } catch (err) { next(err); }
  }

  async setJrwaSeriesLegalHold(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await retentionService.setJrwaSeriesLegalHold(
        req.params.id, req.tenantId || null, req.user!, req.body.hold, req.body.reason,
      );
      return successResponse(res, result);
    } catch (err) { next(err); }
  }

  async getPolicy(req: Request, res: Response, next: NextFunction) {
    try {
      const policy = await retentionService.getPolicy(req.params.id, req.tenantId || null);
      return successResponse(res, policy);
    } catch (err) { next(err); }
  }

  async createPolicy(req: Request, res: Response, next: NextFunction) {
    try {
      const policy = await retentionService.createPolicy(req.tenantId || null, req.user!, req.body);
      return successResponse(res, policy, 201);
    } catch (err) { next(err); }
  }

  async updatePolicy(req: Request, res: Response, next: NextFunction) {
    try {
      const policy = await retentionService.updatePolicy(req.params.id, req.tenantId || null, req.user!, req.body);
      return successResponse(res, policy);
    } catch (err) { next(err); }
  }

  async deletePolicy(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await retentionService.deletePolicy(req.params.id, req.tenantId || null, req.user!);
      return successResponse(res, result);
    } catch (err) { next(err); }
  }

  async recalculate(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await retentionService.recalculateForPolicy(req.params.id, req.tenantId || null, req.user!);
      return successResponse(res, result);
    } catch (err) { next(err); }
  }

  async getBoxesForReview(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const days = Math.min(365, Math.max(1, parseInt(req.query.days as string, 10) || 90));
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 25));
      const scope = req.query.scope === 'due' ? 'due' : 'upcoming';
      const boxes = await retentionService.getBoxesForReview(req.tenantId, days, scope, page, limit);
      return successResponse(res, boxes);
    } catch (err) { next(err); }
  }

  async getPendingDisposal(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 25));
      const boxes = await retentionService.getPendingDisposal(req.tenantId, page, limit);
      return successResponse(res, boxes);
    } catch (err) { next(err); }
  }

  async getApprovedDisposal(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 25));
      const boxes = await retentionService.getApprovedDisposal(req.tenantId, page, limit);
      return successResponse(res, boxes);
    } catch (err) { next(err); }
  }

  async getCompletedDisposal(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 25));
      return successResponse(res, await retentionService.getCompletedDisposal(req.tenantId, page, limit));
    } catch (err) { next(err); }
  }

  async downloadDisposalConfirmation(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      if (!z.string().uuid().safeParse(req.params.id).success) return errorResponse(res, 'Nieprawidłowy identyfikator potwierdzenia', 400);
      const record = await retentionService.getCompletedDisposalRecord(req.tenantId, req.params.id);
      const evidence = await disposalEvidenceService.forPdf(req.tenantId, req.params.id);
      const pdf = await buildDisposalConfirmationPdf(parseDisposalConfirmation(record), evidence);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="archivecore-brakowanie-${req.params.id}.pdf"`);
      res.setHeader('Cache-Control', 'private, no-store');
      return res.send(pdf);
    } catch (err) { next(err); }
  }

  async listDisposalEvidence(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      if (!z.string().uuid().safeParse(req.params.id).success) return errorResponse(res, 'Nieprawidłowy identyfikator brakowania', 400);
      return successResponse(res, await disposalEvidenceService.list(req.tenantId, req.params.id));
    } catch (err) { next(err); }
  }

  async uploadDisposalEvidence(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      if (!z.string().uuid().safeParse(req.params.id).success) return errorResponse(res, 'Nieprawidłowy identyfikator brakowania', 400);
      if (!req.file) return errorResponse(res, 'Dołącz zdjęcie JPEG lub PNG o rozmiarze do 5 MB', 400);
      return successResponse(res, await disposalEvidenceService.upload(req.tenantId, req.params.id, req.user!.userId, req.file), 201);
    } catch (err) { next(err); }
  }

  async downloadDisposalEvidence(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      if (!z.string().uuid().safeParse(req.params.id).success || !z.string().uuid().safeParse(req.params.evidenceId).success) {
        return errorResponse(res, 'Nieprawidłowy identyfikator zdjęcia', 400);
      }
      const file = await disposalEvidenceService.download(req.tenantId, req.params.id, req.params.evidenceId);
      res.setHeader('Content-Type', file.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="disposal-evidence-${req.params.evidenceId}.${file.mimeType === 'image/png' ? 'png' : 'jpg'}"`);
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.send(file.buffer);
    } catch (err) { next(err); }
  }

  async initiateDisposal(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const result = await retentionService.initiateDisposal(req.tenantId, req.body.boxIds, req.user!.userId, req.body.notes);
      return successResponse(res, result);
    } catch (err) { next(err); }
  }

  async reviewDisposal(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      return successResponse(res, await retentionService.reviewDisposal(req.tenantId, req.body.boxIds, req.user!.userId, req.body.notes));
    } catch (err) { next(err); }
  }

  async approveDisposal(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const result = await retentionService.approveDisposal(req.tenantId, req.body.boxIds, req.user!, req.body.notes);
      return successResponse(res, result);
    } catch (err) { next(err); }
  }

  async rejectDisposal(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const result = await retentionService.rejectDisposal(req.tenantId, req.body.boxIds, req.user!, req.body.reason);
      return successResponse(res, result);
    } catch (err) { next(err); }
  }

  async recordApDecision(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      return successResponse(res, await retentionService.recordApDecision(
        req.tenantId, req.body.boxIds, req.user!, req.body.decision,
        req.body.reference, req.body.decisionDate, req.body.reason,
      ));
    } catch (err) { next(err); }
  }

  async completeDisposal(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.tenantId) return errorResponse(res, 'Brak kontekstu tenanta', 400);
      const result = await retentionService.completeDisposal(req.tenantId, req.body.boxIds, req.user!.userId, req.body.protocolReference, {
        methodDescription: req.body.methodDescription,
        weightKg: req.body.weightKg,
        executionNote: req.body.executionNote,
      });
      return successResponse(res, result);
    } catch (err) { next(err); }
  }
}

export const retentionController = new RetentionController();
