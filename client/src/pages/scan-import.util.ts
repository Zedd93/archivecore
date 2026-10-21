export interface ScanRow {
  id: string;
  folderSignature: string;
  folderTitle: string;
  categoryCode: string;
  dateFrom: string;
  dateTo: string;
  dateRangeUnknown: boolean;
  boxNumber: string;
  notes: string;
}

export const emptyScanRow = (): ScanRow => ({
  id: crypto.randomUUID(), folderSignature: '', folderTitle: '', categoryCode: '', dateFrom: '', dateTo: '', dateRangeUnknown: false, boxNumber: '', notes: '',
});

export function draftScanRows(text: string): ScanRow[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 500).map((line) => {
    const cells = line.split(/\t+|\s*;\s*| {2,}/).map((cell) => cell.trim()).filter(Boolean);
    if (/^\d+[.)]?$/.test(cells[0]) && cells.length > 1) cells.shift();
    if (/znak teczki|tytuł teczki|kat\. akt/i.test(line)) return null;
    if (cells.length < 3 || !/^(?:A|B|BE)\d*(?:\+\d+)?$/i.test(cells[cells.length - 1])) {
      return { ...emptyScanRow(), folderTitle: line };
    }
    const dateRangeUnknown = cells.length >= 4 && /^brak\s+dat$/i.test(cells[cells.length - 2]);
    return {
      ...emptyScanRow(),
      folderSignature: cells[0],
      folderTitle: cells.slice(1, dateRangeUnknown ? -2 : -1).join(' '),
      categoryCode: cells[cells.length - 1],
      dateRangeUnknown,
    };
  }).filter((row): row is ScanRow => row !== null);
}
