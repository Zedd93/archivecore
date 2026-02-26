import { Request, Response } from 'express';
import { ShareLinkService } from './share-link.service';

export class ShareLinkController {
  /**
   * POST /share-links — Create a share link (authenticated)
   */
  static async create(req: Request, res: Response) {
    try {
      const { entityType, entityId, recipientEmail, expiresInDays } = req.body;

      if (!entityType || !entityId) {
        return res.status(400).json({ error: 'entityType and entityId are required' });
      }

      if (!['box', 'order', 'hr', 'transfer_list'].includes(entityType)) {
        return res.status(400).json({ error: 'Invalid entityType' });
      }

      const tenantId = (req as any).tenantId;
      const userId = (req as any).userId;

      const link = await ShareLinkService.create({
        tenantId,
        entityType,
        entityId,
        createdById: userId,
        recipientEmail,
        expiresInDays: expiresInDays || 7,
      });

      const shareUrl = `${req.protocol}://${req.get('host')}/share/${link.token}`;

      res.status(201).json({
        ...link,
        shareUrl,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * GET /share-links — List share links (authenticated)
   */
  static async list(req: Request, res: Response) {
    try {
      const tenantId = (req as any).tenantId;
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 20;

      const result = await ShareLinkService.list(tenantId, page, limit);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * DELETE /share-links/:id — Delete a share link (authenticated)
   */
  static async delete(req: Request, res: Response) {
    try {
      const tenantId = (req as any).tenantId;
      const { id } = req.params;

      await ShareLinkService.delete(id, tenantId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * GET /public/share/:token — Public access to shared entity (NO AUTH)
   */
  static async publicAccess(req: Request, res: Response) {
    try {
      const { token } = req.params;

      const link = await ShareLinkService.findByToken(token);
      if (!link) {
        return res.status(404).json({
          error: 'Link nie istnieje lub wygasł',
          expired: true,
        });
      }

      const entity = await ShareLinkService.getSharedEntity(
        link.entityType,
        link.entityId,
        link.tenantId
      );

      if (!entity) {
        return res.status(404).json({ error: 'Obiekt nie znaleziony' });
      }

      res.json({
        entityType: link.entityType,
        entity,
        expiresAt: link.expiresAt,
        accessCount: link.accessCount,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}
