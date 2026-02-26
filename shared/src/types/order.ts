export type OrderType = 'checkout' | 'return_order' | 'transfer' | 'disposal';
export type OrderStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'in_progress' | 'ready' | 'delivered' | 'completed' | 'cancelled';
export type OrderPriority = 'normal' | 'high' | 'urgent';
export type OrderItemStatus = 'pending' | 'picked' | 'delivered' | 'returned' | 'issue';
export type CustodyEventType = 'handover' | 'receipt' | 'return_event' | 'transfer';

export interface IOrder {
  id: string;
  tenantId: string;
  orderNumber: string;
  orderType: OrderType;
  status: OrderStatus;
  priority: OrderPriority;
  requestedBy: string;
  approvedBy: string | null;
  assignedTo: string | null;
  slaDeadline: string | null;
  completedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IOrderWithDetails extends IOrder {
  requester: { id: string; firstName: string; lastName: string };
  approver?: { id: string; firstName: string; lastName: string } | null;
  assignee?: { id: string; firstName: string; lastName: string } | null;
  items: IOrderItem[];
  _count?: { items: number };
}

export interface IOrderItem {
  id: string;
  orderId: string;
  boxId: string | null;
  folderId: string | null;
  hrFolderId: string | null;
  itemStatus: OrderItemStatus;
  pickedAt: string | null;
  deliveredAt: string | null;
  pickedById: string | null;
}

export interface ICreateOrder {
  orderType: OrderType;
  priority?: OrderPriority;
  notes?: string;
  items: { boxId?: string; folderId?: string; hrFolderId?: string }[];
}

export interface ICustodyEvent {
  id: string;
  orderId: string | null;
  boxId: string;
  eventType: CustodyEventType;
  fromUserId: string | null;
  toUserId: string | null;
  fromLocationId: string | null;
  toLocationId: string | null;
  signatureData: string | null;
  notes: string | null;
  eventAt: string;
}

export interface ICreateCustodyEvent {
  boxId: string;
  eventType: CustodyEventType;
  toUserId?: string;
  toLocationId?: string;
  notes?: string;
  signatureData?: string;
}
