export interface InventoryBox {
  id: string;
  boxNumber: string;
  title: string;
  qrCode: string;
  status: string;
  locationId: string | null;
  location?: { fullPath: string } | null;
}

export function escapeInventoryCsvCell(value: string) {
  const safeValue = /^[=+\-@]/.test(value.trimStart()) ? `'${value}` : value;
  return `"${safeValue.replace(/"/g, '""')}"`;
}

export function reconcileInventory(locationId: string, expected: InventoryBox[], scanned: InventoryBox[]) {
  const expectedIds = new Set(expected.map((box) => box.id));
  const scannedIds = new Set(scanned.map((box) => box.id));
  return {
    matched: scanned.filter((box) => box.locationId === locationId && expectedIds.has(box.id)),
    missing: expected.filter((box) => !scannedIds.has(box.id)),
    wrongLocation: scanned.filter((box) => box.locationId !== locationId),
    unexpected: scanned.filter((box) => box.locationId === locationId && !expectedIds.has(box.id)),
  };
}
