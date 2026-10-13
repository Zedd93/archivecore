export interface CapacityNode {
  id: string;
  parentId: string | null;
  fullPath: string;
  capacity: number | null;
  isActive: boolean;
}

export function findOverCapacityLocations(locations: CapacityNode[], directCounts: Map<string, number>) {
  const children = new Map<string, string[]>();
  for (const location of locations) {
    if (!location.parentId) continue;
    const siblings = children.get(location.parentId) ?? [];
    siblings.push(location.id);
    children.set(location.parentId, siblings);
  }

  const occupied = new Map<string, number>();
  const visiting = new Set<string>();
  const count = (id: string): number => {
    if (occupied.has(id)) return occupied.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const total = (directCounts.get(id) ?? 0) + (children.get(id) ?? []).reduce((sum, childId) => sum + count(childId), 0);
    visiting.delete(id);
    occupied.set(id, total);
    return total;
  };

  return locations
    .filter((location) => location.isActive && location.capacity !== null)
    .map((location) => ({ id: location.id, fullPath: location.fullPath, capacity: location.capacity!, occupied: count(location.id) }))
    .filter((location) => location.occupied > location.capacity)
    .sort((a, b) => b.occupied - b.capacity - (a.occupied - a.capacity) || a.fullPath.localeCompare(b.fullPath, 'pl'));
}
