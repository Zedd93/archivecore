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

export { reconcileInventory } from '@archivecore/shared';
