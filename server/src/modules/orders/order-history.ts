export const ORDER_HISTORY_ACTIONS = [
  'order.create',
  'order.submit',
  'order.approve',
  'order.reject',
  'order.process',
  'order.ready',
  'order.scan_quote.prepare',
  'order.scan_quote.approve',
  'order.deliver',
  'order.complete',
  'order.cancel',
  'order.assign',
];

interface OrderAuditEntry {
  id: string;
  action: string;
  createdAt: Date;
  oldValues: unknown;
  newValues: unknown;
  user: { firstName: string; lastName: string } | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function toOrderHistoryEntry(log: OrderAuditEntry) {
  const previousNotes = asRecord(log.oldValues).notes;
  const nextNotes = asRecord(log.newValues).notes;
  const reason = (log.action === 'order.reject' || (log.action === 'order.cancel' && nextNotes !== previousNotes))
    && typeof nextNotes === 'string'
    && nextNotes.trim()
      ? nextNotes.trim()
      : null;

  return {
    id: log.id,
    action: log.action,
    entityType: 'order',
    createdAt: log.createdAt,
    user: log.user,
    reason,
  };
}

interface SlaEscalationEntry {
  id: string;
  level: number;
  createdAt: Date;
}

export function toOrderSlaHistoryEntry(event: SlaEscalationEntry) {
  return {
    id: event.id,
    action: `order.sla_${event.level}`,
    entityType: 'order',
    createdAt: event.createdAt,
    user: null,
    reason: null,
  };
}

type OrderHistoryEntry = ReturnType<typeof toOrderHistoryEntry>;

export function mergeOrderHistory(
  auditEntries: OrderHistoryEntry[],
  slaEntries: SlaEscalationEntry[],
  skip: number,
  take: number,
) {
  return [...auditEntries, ...slaEntries.map(toOrderSlaHistoryEntry)]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))
    .slice(skip, skip + take);
}
