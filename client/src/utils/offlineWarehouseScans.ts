const PREFIX = 'archivecore:warehouse-scans:';
const MAX_CODES = 200;

interface StoredScans {
  codes: string[];
}

export function warehouseScanKey(userId: string, tenantId: string, operation: 'move' | 'receive') {
  return `${PREFIX}${userId}:${tenantId}:${operation}`;
}

export function readWarehouseScans(key: string): string[] {
  if (!key) return [];
  try {
    const value = localStorage.getItem(key);
    if (!value) return [];
    const stored = JSON.parse(value) as StoredScans;
    return Array.isArray(stored.codes)
      ? stored.codes.filter((code): code is string => typeof code === 'string' && code.length <= 500).slice(0, MAX_CODES)
      : [];
  } catch {
    return [];
  }
}

export function saveWarehouseScans(key: string, codes: string[]): boolean {
  if (!key || codes.length > MAX_CODES) return false;
  try {
    if (codes.length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify({ codes } satisfies StoredScans));
    return true;
  } catch {
    return false;
  }
}

export function clearWarehouseScans() {
  try {
    for (let index = localStorage.length - 1; index >= 0; index--) {
      const key = localStorage.key(index);
      if (key?.startsWith(PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    // Storage may be unavailable in a restricted browser session.
  }
}
