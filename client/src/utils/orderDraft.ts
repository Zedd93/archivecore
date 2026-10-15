export interface OrderDraftItem {
  type: 'box' | 'folder' | 'document';
  id: string;
  title: string;
  boxNumber?: string;
  source?: 'manual' | 'transfer_list';
}

interface SearchResultForOrder {
  type: string;
  id: string;
  title: string;
  metadata?: { source?: string; boxNumber?: string };
}

export function toOrderDraftItem(result: SearchResultForOrder): OrderDraftItem | null {
  if (result.metadata?.source === 'attachment' || result.metadata?.source === 'hr_document') return null;
  if (result.type !== 'box' && result.type !== 'folder' && result.type !== 'document') return null;
  return {
    type: result.type,
    id: result.id,
    title: result.title,
    boxNumber: result.metadata?.boxNumber,
    ...(result.type === 'folder' ? { source: result.metadata?.source === 'transfer_list_item' ? 'transfer_list' as const : 'manual' as const } : {}),
  };
}

export function readOrderDraft(state: unknown, tenantId: string | null): OrderDraftItem[] {
  const draft = (state as { orderDraft?: { tenantId?: string; items?: unknown } } | null)?.orderDraft;
  if (!tenantId || draft?.tenantId !== tenantId || !Array.isArray(draft.items)) return [];

  const seen = new Set<string>();
  return draft.items.filter((item): item is OrderDraftItem => {
    if (!item || typeof item !== 'object') return false;
    const entry = item as Record<string, unknown>;
    if (entry.type !== 'box' && entry.type !== 'folder' && entry.type !== 'document') return false;
    if (typeof entry.id !== 'string' || typeof entry.title !== 'string') return false;
    const key = `${entry.type}:${entry.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
