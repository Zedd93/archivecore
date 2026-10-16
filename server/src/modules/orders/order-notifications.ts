import { OrderStatus } from '@prisma/client';
import { Permissions, RoleCode } from '@archivecore/shared';

type OrderPermission = (typeof Permissions)[keyof typeof Permissions];

export function orderNotificationAudience(status: OrderStatus): {
  requiredPermissions: OrderPermission[];
  onlyIncludedUsers: boolean;
} {
  switch (status) {
    case 'submitted':
      return { requiredPermissions: [Permissions.ORDER_APPROVE], onlyIncludedUsers: false };
    case 'approved':
    case 'in_progress':
    case 'ready':
      return { requiredPermissions: [Permissions.ORDER_PROCESS], onlyIncludedUsers: false };
    case 'delivered':
      return { requiredPermissions: [Permissions.ORDER_COMPLETE], onlyIncludedUsers: false };
    case 'completed':
    case 'rejected':
    case 'cancelled':
      return { requiredPermissions: [], onlyIncludedUsers: true };
    default:
      return { requiredPermissions: [], onlyIncludedUsers: true };
  }
}

export function scanQuoteNotification(
  order: { id: string; tenantId: string; orderNumber: string; assignedTo?: string | null },
  event: 'ready' | 'approved',
  actorId: string,
) {
  const base = {
    tenantId: order.tenantId,
    entityType: 'order',
    entityId: order.id,
    actionUrl: `/orders/${order.id}`,
    excludeUserIds: [actorId],
  };
  if (event === 'ready') {
    return {
      ...base,
      type: 'order_scan_quote_ready',
      title: `Wycena skanu ${order.orderNumber} czeka na akceptację`,
      message: `Sprawdź koszt skanowania w zleceniu ${order.orderNumber} i zatwierdź go przed udostępnieniem plików.`,
      requiredRoleCodes: [RoleCode.TENANT_LEADERSHIP, RoleCode.ADMIN_TENANT],
      includeGlobalUsers: false,
    };
  }
  return {
    ...base,
    type: 'order_scan_quote_approved',
    title: `Zaakceptowano wycenę skanu ${order.orderNumber}`,
    message: `Klient zaakceptował koszt skanowania w zleceniu ${order.orderNumber}. Można udostępnić skany.`,
    requiredRoleCodes: [RoleCode.SUPER_ADMIN, RoleCode.DOXART_ADMIN, RoleCode.COORDINATOR_ARCHIVE],
    includeUserIds: order.assignedTo ? [order.assignedTo] : [],
  };
}
