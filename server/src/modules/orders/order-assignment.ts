import { OrderStatus } from '@prisma/client';
import { Permissions, ROLE_PERMISSIONS, RoleCode } from '@archivecore/shared';

export const PROCESSING_ROLE_CODES = Object.values(RoleCode).filter((code) =>
  ROLE_PERMISSIONS[code].includes(Permissions.ORDER_PROCESS)
);

export function canAssignOrder(status: OrderStatus): boolean {
  return !['delivered', 'completed', 'rejected', 'cancelled'].includes(status);
}
