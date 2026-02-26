import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

export class ShareLinkService {
  /**
   * Create a new share link for an entity
   */
  static async create(data: {
    tenantId: string;
    entityType: string;
    entityId: string;
    createdById: string;
    recipientEmail?: string;
    expiresInDays?: number;
  }) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + (data.expiresInDays || 7));

    return prisma.shareLink.create({
      data: {
        tenantId: data.tenantId,
        entityType: data.entityType,
        entityId: data.entityId,
        createdById: data.createdById,
        recipientEmail: data.recipientEmail,
        token,
        expiresAt,
      },
    });
  }

  /**
   * List share links for a tenant
   */
  static async list(tenantId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      prisma.shareLink.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          creator: { select: { firstName: true, lastName: true, email: true } },
        },
      }),
      prisma.shareLink.count({ where: { tenantId } }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Find share link by token — public (no auth required)
   */
  static async findByToken(token: string) {
    const link = await prisma.shareLink.findUnique({
      where: { token },
    });

    if (!link) return null;
    if (new Date() > link.expiresAt) return null; // expired

    // Increment access count
    await prisma.shareLink.update({
      where: { id: link.id },
      data: {
        accessCount: { increment: 1 },
        lastAccessedAt: new Date(),
      },
    });

    return link;
  }

  /**
   * Get the shared entity data (box, order, HR folder, transfer list)
   */
  static async getSharedEntity(entityType: string, entityId: string, tenantId: string) {
    switch (entityType) {
      case 'box':
        return prisma.box.findFirst({
          where: { id: entityId, tenantId },
          include: {
            location: true,
            tenant: { select: { name: true, shortCode: true } },
            _count: { select: { folders: true, documents: true, transferListItems: true } },
          },
        });

      case 'order':
        return prisma.order.findFirst({
          where: { id: entityId, tenantId },
          include: {
            requester: { select: { firstName: true, lastName: true } },
            assignee: { select: { firstName: true, lastName: true } },
            items: {
              include: {
                box: { select: { boxNumber: true, title: true } },
              },
            },
          },
        });

      case 'hr':
        return prisma.hRFolder.findFirst({
          where: { id: entityId, tenantId },
          select: {
            id: true,
            employeeFirstName: true,
            employeeLastName: true,
            department: true,
            position: true,
            employmentStatus: true,
            retentionPeriod: true,
            storageForm: true,
            // Do NOT expose PESEL or other sensitive data
          },
        });

      case 'transfer_list':
        return prisma.transferList.findFirst({
          where: { id: entityId, tenantId },
          include: {
            _count: { select: { items: true } },
          },
        });

      default:
        return null;
    }
  }

  /**
   * Delete a share link
   */
  static async delete(id: string, tenantId: string) {
    return prisma.shareLink.deleteMany({
      where: { id, tenantId },
    });
  }

  /**
   * Revoke (delete) expired share links — cleanup task
   */
  static async revokeExpired() {
    return prisma.shareLink.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
  }
}
