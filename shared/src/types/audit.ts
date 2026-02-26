export interface IAuditLog {
  id: string;
  tenantId: string | null;
  userId: string;
  action: string;
  entityType: string;
  entityId: string | null;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  user?: { firstName: string; lastName: string; email: string };
}

export interface IAuditLogFilter {
  tenantId?: string;
  userId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  dateFrom?: string;
  dateTo?: string;
}
