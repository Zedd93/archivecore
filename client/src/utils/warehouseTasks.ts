export interface WarehouseTask {
  id: string;
  orderNumber: string;
  orderType: string;
  status: string;
  priority: string;
  slaDeadline: string | null;
  createdAt: string;
  assignee?: { firstName: string; lastName: string } | null;
}

const priorityOrder: Record<string, number> = { urgent: 0, high: 1, normal: 2 };

function deadlineValue(value: string | null) {
  if (!value) return Number.POSITIVE_INFINITY;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
}

export function sortWarehouseTasks<T extends WarehouseTask>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) =>
    deadlineValue(a.slaDeadline) - deadlineValue(b.slaDeadline)
    || (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3)
    || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}
