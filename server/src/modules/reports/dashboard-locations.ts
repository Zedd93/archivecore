interface DashboardLocation {
  id: string;
  parentId: string | null;
  capacity: number | null;
}

export function summarizeDashboardLocations(
  locations: DashboardLocation[],
  directCounts: Map<string, number>,
): { totalLocations: number; occupancyRate: number | null } {
  const byId = new Map(locations.map((location) => [location.id, location]));
  const children = new Map<string, string[]>();
  for (const location of locations) {
    if (!location.parentId || !byId.has(location.parentId)) continue;
    const siblings = children.get(location.parentId) ?? [];
    siblings.push(location.id);
    children.set(location.parentId, siblings);
  }

  const occupied = (id: string): number =>
    (directCounts.get(id) ?? 0) + (children.get(id) ?? []).reduce((sum, child) => sum + occupied(child), 0);

  // A parent's capacity already covers its descendants; otherwise use the capacities of its branches.
  const capacity = (id: string): number | null => {
    const own = byId.get(id)!.capacity;
    if (own !== null) return own;
    const descendants = children.get(id) ?? [];
    if (descendants.length === 0) return null;
    const branchCapacities = descendants.map(capacity);
    return branchCapacities.some((value) => value === null)
      ? null
      : branchCapacities.reduce<number>((sum, value) => sum + value!, 0);
  };

  const roots = locations.filter((location) => !location.parentId || !byId.has(location.parentId));
  const capacities = roots.map((location) => capacity(location.id));
  const totalCapacity = capacities.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const occupancyRate = roots.length > 0 && capacities.every((value) => value !== null) && totalCapacity > 0
    ? Math.round((roots.reduce((sum, location) => sum + occupied(location.id), 0) / totalCapacity) * 100)
    : null;

  return { totalLocations: locations.length, occupancyRate };
}
