export interface InventoryRecord {
  id: string;
  locationId: string | null;
}

export type InventoryDiscrepancyKind = 'missing' | 'wrong_location' | 'unexpected';

export function reconcileInventory<T extends InventoryRecord>(locationId: string, expected: T[], scanned: T[]) {
  const expectedIds = new Set(expected.map((box) => box.id));
  const scannedIds = new Set(scanned.map((box) => box.id));
  return {
    matched: scanned.filter((box) => box.locationId === locationId && expectedIds.has(box.id)),
    missing: expected.filter((box) => !scannedIds.has(box.id)),
    wrongLocation: scanned.filter((box) => box.locationId !== locationId),
    unexpected: scanned.filter((box) => box.locationId === locationId && !expectedIds.has(box.id)),
  };
}
