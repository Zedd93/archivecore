export interface ScanRow {
  id: string;
  folderSignature: string;
  folderTitle: string;
  categoryCode: string;
  dateFrom: string;
  dateTo: string;
  dateRangeUnknown: boolean;
  sourcePage?: number;
  boxNumber: string;
  notes: string;
}

export const emptyScanRow = (): ScanRow => ({
  id: crypto.randomUUID(), folderSignature: '', folderTitle: '', categoryCode: '', dateFrom: '', dateTo: '', dateRangeUnknown: false, boxNumber: '', notes: '',
});

export function draftScanRows(text: string, sourcePage?: number): ScanRow[] {
  const newRow = () => ({ ...emptyScanRow(), ...(sourcePage ? { sourcePage } : {}) });
  const rows: ScanRow[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /znak teczki|tytuł teczki|kat\. akt/i.test(line)) continue;
    const cells = line.split(/\t+|\s*;\s*| {2,}/).map((cell) => cell.trim()).filter(Boolean);
    if (/^\d+[.)]?$/.test(cells[0]) && cells.length > 1) cells.shift();
    if (cells.length < 3 || !/^(?:A|B|BE)\d*(?:\+\d+)?$/i.test(cells[cells.length - 1])) {
      rows.push({ ...newRow(), folderTitle: line });
    } else {
      const dateRangeUnknown = cells.length >= 4 && /^brak\s+dat$/i.test(cells[cells.length - 2]);
      rows.push({
        ...newRow(),
        folderSignature: cells[0],
        folderTitle: cells.slice(1, dateRangeUnknown ? -2 : -1).join(' '),
        categoryCode: cells[cells.length - 1],
        dateRangeUnknown,
      });
    }
    if (rows.length > 500) break;
  }
  return rows;
}

export function draftScanPages(pageTexts: string[], emptyPages: number[]) {
  const rows: ScanRow[] = [];
  for (const [index, text] of pageTexts.entries()) {
    if (emptyPages.includes(index + 1)) continue;
    const pageRows = draftScanRows(text, index + 1);
    if (!pageRows.length) return { rows: [], missingPage: index + 1, tooMany: false };
    rows.push(...pageRows);
    if (rows.length > 500) return { rows: [], missingPage: null, tooMany: true };
  }
  return { rows, missingPage: null, tooMany: false };
}
