interface PickBox {
  boxNumber: string;
  location?: { fullPath: string } | null;
}

interface PickFolder {
  box?: PickBox | null;
}

export interface RouteOrderItem {
  id: string;
  itemStatus: string;
  box?: PickBox | null;
  folder?: PickFolder | null;
  document?: { box?: PickBox | null; folder?: PickFolder | null } | null;
  transferListItem?: { box?: PickBox | null; folder?: PickFolder | null } | null;
  hrFolder?: { box?: PickBox | null } | null;
}

const collator = new Intl.Collator('pl', { numeric: true, sensitivity: 'base' });

export function getOrderItemPickBox(item: RouteOrderItem): PickBox | null {
  return item.box
    ?? item.folder?.box
    ?? item.document?.box
    ?? item.document?.folder?.box
    ?? item.transferListItem?.box
    ?? item.transferListItem?.folder?.box
    ?? item.hrFolder?.box
    ?? null;
}

export function getOrderItemPickLocation(item: RouteOrderItem): string | null {
  return getOrderItemPickBox(item)?.location?.fullPath?.trim() || null;
}

export function sortOrderItemsByPickRoute<T extends RouteOrderItem>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const aLocation = getOrderItemPickLocation(a);
    const bLocation = getOrderItemPickLocation(b);
    if (!aLocation || !bLocation) {
      if (!aLocation && bLocation) return 1;
      if (aLocation && !bLocation) return -1;
    }
    return collator.compare(aLocation || '', bLocation || '')
      || collator.compare(getOrderItemPickBox(a)?.boxNumber || '', getOrderItemPickBox(b)?.boxNumber || '')
      || Number(b.itemStatus === 'pending') - Number(a.itemStatus === 'pending')
      || collator.compare(a.id, b.id);
  });
}
