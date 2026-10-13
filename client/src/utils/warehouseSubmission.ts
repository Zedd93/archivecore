const PREFIX = 'archivecore:warehouse-submission:';

export interface WarehouseSubmission {
  operationId: string;
  ids: string[];
  locationId: string;
  locationLabel: string;
  notes?: string;
  createdAt: number;
}

export function warehouseSubmissionKey(userId: string, tenantId: string, operation: 'move' | 'receive') {
  return `${PREFIX}${userId}:${tenantId}:${operation}`;
}

export function readWarehouseSubmission(key: string): WarehouseSubmission | null {
  if (!key) return null;
  try {
    const value = localStorage.getItem(key);
    if (!value) return null;
    const entry = JSON.parse(value) as WarehouseSubmission;
    if (typeof entry.operationId !== 'string' || !Array.isArray(entry.ids) || entry.ids.length === 0
      || !entry.ids.every((id) => typeof id === 'string') || typeof entry.locationId !== 'string'
      || typeof entry.locationLabel !== 'string' || (entry.notes !== undefined && typeof entry.notes !== 'string')
      || !Number.isFinite(entry.createdAt)) return null;
    return entry;
  } catch {
    return null;
  }
}

export function saveWarehouseSubmission(key: string, entry: WarehouseSubmission): boolean {
  try {
    if (!key || localStorage.getItem(key)) return false;
    localStorage.setItem(key, JSON.stringify(entry));
    return true;
  } catch {
    return false;
  }
}

export function clearWarehouseSubmission(key: string, operationId: string): boolean {
  try {
    if (readWarehouseSubmission(key)?.operationId !== operationId) return false;
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function clearAllWarehouseSubmissions() {
  try {
    for (let index = localStorage.length - 1; index >= 0; index--) {
      const key = localStorage.key(index);
      if (key?.startsWith(PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    // Storage may be unavailable in a restricted browser session.
  }
}
