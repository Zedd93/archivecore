import { OrderStatus } from '@prisma/client';

// Valid state transitions: { [currentStatus]: allowedNextStatuses[] }
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  draft: ['submitted', 'cancelled'],
  submitted: ['approved', 'rejected', 'cancelled'],
  approved: ['in_progress', 'cancelled'],
  rejected: ['draft'], // can be re-edited
  in_progress: ['ready', 'cancelled'],
  ready: ['delivered', 'cancelled'],
  delivered: ['completed', 'in_progress'], // in_progress for partial returns
  completed: [],
  cancelled: [],
};

export function isValidTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}

// Actions that specific roles can perform
export const STATUS_REQUIRED_ACTION: Partial<Record<OrderStatus, string>> = {
  submitted: 'order.create',
  approved: 'order.approve',
  rejected: 'order.approve',
  in_progress: 'order.process',
  ready: 'order.process',
  delivered: 'order.process',
  completed: 'order.complete',
  cancelled: 'order.create', // requester can cancel
};

export function getRequiredPermissionForTransition(toStatus: OrderStatus): string {
  return STATUS_REQUIRED_ACTION[toStatus] || 'order.create';
}
