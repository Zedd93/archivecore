import { prisma } from '../../config/database';
import { ROLE_PERMISSIONS, PermissionString, RoleCode } from '@archivecore/shared';

type NotificationPayload = {
  tenantId?: string | null;
  type: string;
  title: string;
  message: string;
  entityType?: string;
  entityId?: string;
  actionUrl?: string;
};

type NotifyTenantUsersInput = NotificationPayload & {
  requiredPermissions?: PermissionString[];
  includeUserIds?: string[];
  excludeUserIds?: string[];
};

export class NotificationService {
  async list(userId: string, limit = 20) {
    const take = Math.min(Math.max(limit, 1), 50);
    const [items, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      prisma.notification.count({ where: { userId, readAt: null } }),
    ]);

    return { items, unreadCount };
  }

  async markRead(id: string, userId: string) {
    return prisma.notification.updateMany({
      where: { id, userId },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(userId: string) {
    return prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
  }

  async notifyTenantUsers(input: NotifyTenantUsersInput) {
    const requiredPermissions = input.requiredPermissions ?? [];
    const includeUserIds = new Set(input.includeUserIds ?? []);
    const excludeUserIds = new Set(input.excludeUserIds ?? []);

    const users = await prisma.user.findMany({
      where: {
        isActive: true,
        OR: [
          ...(input.tenantId ? [{ tenantId: input.tenantId }] : []),
          { tenantId: null },
          ...(includeUserIds.size > 0 ? [{ id: { in: [...includeUserIds] } }] : []),
        ],
      },
      select: {
        id: true,
        userRoles: { select: { role: { select: { code: true } } } },
      },
    });

    const targetUserIds = users
      .filter((user) => !excludeUserIds.has(user.id))
      .filter((user) => {
        if (includeUserIds.has(user.id)) return true;
        if (requiredPermissions.length === 0) return true;

        return user.userRoles.some((userRole) => {
          const permissions = ROLE_PERMISSIONS[userRole.role.code as RoleCode];
          return permissions?.some((permission) =>
            requiredPermissions.includes(permission)
          );
        });
      })
      .map((user) => user.id);

    const uniqueUserIds = [...new Set(targetUserIds)];
    if (uniqueUserIds.length === 0) return { count: 0 };

    const result = await prisma.notification.createMany({
      data: uniqueUserIds.map((userId) => ({
        userId,
        tenantId: input.tenantId ?? null,
        type: input.type,
        title: input.title,
        message: input.message,
        entityType: input.entityType,
        entityId: input.entityId,
        actionUrl: input.actionUrl,
      })),
    });

    return { count: result.count };
  }
}

export const notificationService = new NotificationService();
