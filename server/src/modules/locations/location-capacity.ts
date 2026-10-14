export interface CapacityLocation {
  id: string;
  parentId: string | null;
  tenantId: string | null;
  type: string;
  code: string;
  name: string;
  fullPath: string;
  capacity: number | null;
  isActive: boolean;
}

export interface AvailableLocation extends CapacityLocation {
  occupied: number;
  available: number;
}

export function findAvailableLocations(
  locations: CapacityLocation[],
  directCounts: Map<string, number>,
  tenantId: string | null,
  movingFrom: Array<string | null> = [],
): AvailableLocation[] {
  const byId = new Map(locations.map((location) => [location.id, location]));
  const children = new Map<string, string[]>();
  for (const location of locations) {
    if (!location.parentId) continue;
    const siblings = children.get(location.parentId) ?? [];
    siblings.push(location.id);
    children.set(location.parentId, siblings);
  }

  const occupied = new Map<string, number>();
  // A move within an ancestor does not add another box to that ancestor's occupancy.
  const movingWithin = new Map<string, number>();
  for (const sourceId of movingFrom) {
    let current = sourceId ? byId.get(sourceId) : undefined;
    const seen = new Set<string>();
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      movingWithin.set(current.id, (movingWithin.get(current.id) ?? 0) + 1);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
  }
  const visiting = new Set<string>();
  function count(id: string): number {
    if (occupied.has(id)) return occupied.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const total = (directCounts.get(id) ?? 0) + (children.get(id) ?? []).reduce((sum, child) => sum + count(child), 0);
    visiting.delete(id);
    occupied.set(id, total);
    return total;
  }

  const candidates: AvailableLocation[] = [];
  for (const location of locations) {
    if (!location.isActive || !['shelf', 'level', 'slot'].includes(location.type)) continue;
    if (tenantId && location.tenantId !== null && location.tenantId !== tenantId) continue;

    let available = Infinity;
    let ancestor: CapacityLocation | undefined = location;
    const seen = new Set<string>();
    while (ancestor && !seen.has(ancestor.id)) {
      seen.add(ancestor.id);
      if (!ancestor.isActive) {
        available = 0;
        break;
      }
      if (tenantId && ancestor.tenantId !== null && ancestor.tenantId !== tenantId) {
        available = 0;
        break;
      }
      if (ancestor.capacity !== null) {
        available = Math.min(available, ancestor.capacity - count(ancestor.id) + (movingWithin.get(ancestor.id) ?? 0));
      }
      ancestor = ancestor.parentId ? byId.get(ancestor.parentId) : undefined;
    }
    if (Number.isFinite(available) && available > 0) {
      candidates.push({ ...location, occupied: count(location.id), available });
    }
  }

  return candidates.sort((a, b) => b.available - a.available || a.fullPath.localeCompare(b.fullPath, 'pl'));
}
