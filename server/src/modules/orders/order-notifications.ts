import { OrderStatus } from '@prisma/client';
import { Permissions } from '@archivecore/shared';

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
