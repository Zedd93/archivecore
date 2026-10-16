export function scanItemPages(items: Array<{ id: string; scanFile?: { pageCount: number } | null }>) {
  return items.map((item) => ({ itemId: item.id, pageCount: item.scanFile?.pageCount || 0 }))
    .sort((left, right) => left.itemId.localeCompare(right.itemId));
}

export function scanQuoteMatchesItems(
  quotedPages: unknown,
  items: Array<{ id: string; scanFile?: { pageCount: number } | null }>,
) {
  const current = scanItemPages(items);
  return current.length > 0 && current.every((item) => item.pageCount > 0)
    && Array.isArray(quotedPages) && quotedPages.length === current.length
    && current.every((item, index) => {
      const quoted = quotedPages[index];
      return quoted && typeof quoted === 'object' && !Array.isArray(quoted)
        && quoted.itemId === item.itemId && quoted.pageCount === item.pageCount;
    });
}
