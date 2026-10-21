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

type ScanField = 'folderSignature' | 'folderTitle' | 'categoryCode' | 'dateRange' | 'dateFrom' | 'dateTo' | 'boxNumber';
type Header = (ScanField | null)[];

const HEADER_FIELDS: Record<string, ScanField> = {
  'znak teczki': 'folderSignature', sygnatura: 'folderSignature', sygn: 'folderSignature',
  'tytul teczki': 'folderTitle', 'tytul teczki lub tomu': 'folderTitle', 'tytul teczki tomu': 'folderTitle', tytul: 'folderTitle',
  'daty skrajne': 'dateRange', 'daty skrajne od do': 'dateRange',
  'daty skrajne od': 'dateFrom', 'daty skrajne do': 'dateTo',
  'data od': 'dateFrom', 'data do': 'dateTo',
  'kat akt': 'categoryCode', kategoria: 'categoryCode', 'kategoria akt': 'categoryCode',
  'numer kartonu': 'boxNumber', 'nr kartonu': 'boxNumber', karton: 'boxNumber',
};
const CATEGORY = /^(?:A|BE|Bc|B)\d*(?:\+\d+)?$/i;

export const emptyScanRow = (): ScanRow => ({
  id: crypto.randomUUID(), folderSignature: '', folderTitle: '', categoryCode: '', dateFrom: '', dateTo: '', dateRangeUnknown: false, boxNumber: '', notes: '',
});

function normalizeHeader(value: string): string {
  return value.normalize('NFKD').toLowerCase().replace(/ł/g, 'l').replace(/\p{M}/gu, '')
    .replace(/(?<=\p{L})-\s*(?=\p{L})/gu, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function splitCells(line: string): { cells: string[]; delimited: boolean } {
  if (line.includes(';')) return { cells: line.split(';').map((cell) => cell.trim()), delimited: true };
  if (line.includes('\t')) return { cells: line.split('\t').map((cell) => cell.trim()), delimited: true };
  return { cells: line.trim().split(/ {2,}/).map((cell) => cell.trim()), delimited: false };
}

function detectHeader(cells: string[]): Header | null {
  const header = cells.map((cell) => HEADER_FIELDS[normalizeHeader(cell)] || null);
  return header.includes('folderSignature') && header.includes('folderTitle') && header.includes('categoryCode') ? header : null;
}

function validYear(value: string): boolean {
  return /^\d{4}$/.test(value) && Number(value) >= 1000 && Number(value) <= 3000;
}

function parseYearRange(value: string): Pick<ScanRow, 'dateFrom' | 'dateTo' | 'dateRangeUnknown'> {
  if (/^brak\s+dat$/i.test(value)) return { dateFrom: '', dateTo: '', dateRangeUnknown: true };
  const range = value.match(/^(\d{4})\s*[-–—]\s*(\d{4})$/);
  if (range && validYear(range[1]) && validYear(range[2]) && Number(range[1]) <= Number(range[2])) {
    return { dateFrom: `${range[1]}-01-01`, dateTo: `${range[2]}-12-31`, dateRangeUnknown: false };
  }
  if (validYear(value)) return { dateFrom: `${value}-01-01`, dateTo: `${value}-12-31`, dateRangeUnknown: false };
  return { dateFrom: '', dateTo: '', dateRangeUnknown: false };
}

function parseDateCell(value: string, endOfYear: boolean): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value) && validYear(value.slice(0, 4))) {
    const date = new Date(`${value}T00:00:00Z`);
    if (!Number.isNaN(date.getTime()) && date.toISOString().startsWith(value)) return value;
  }
  if (validYear(value)) return `${value}-${endOfYear ? '12-31' : '01-01'}`;
  return '';
}

function mappedRow(cells: string[], header: Header, sourcePage?: number): ScanRow {
  const fields: Partial<Record<ScanField, string>> = {};
  header.forEach((field, index) => { if (field) fields[field] = cells[index] || ''; });
  const dates = parseYearRange(fields.dateRange || '');
  const dateRangeUnknown = dates.dateRangeUnknown || [fields.dateFrom, fields.dateTo].some((value) => /^brak\s+dat$/i.test(value || ''));
  return {
    ...emptyScanRow(),
    ...(sourcePage ? { sourcePage } : {}),
    folderSignature: fields.folderSignature || '',
    folderTitle: fields.folderTitle || '',
    categoryCode: CATEGORY.test(fields.categoryCode || '') ? fields.categoryCode! : '',
    boxNumber: fields.boxNumber || '',
    dateFrom: dateRangeUnknown ? '' : parseDateCell(fields.dateFrom || '', false) || dates.dateFrom,
    dateTo: dateRangeUnknown ? '' : parseDateCell(fields.dateTo || '', true) || dates.dateTo,
    dateRangeUnknown,
  };
}

function fallbackRow(cells: string[], line: string, sourcePage?: number): ScanRow {
  const values = cells.filter(Boolean);
  if (/^\d+[.)]?$/.test(values[0]) && values.length > 1) values.shift();
  const categoryIndex = values.findIndex((cell, index) => index >= 2 && CATEGORY.test(cell));
  if (categoryIndex < 0) return { ...emptyScanRow(), ...(sourcePage ? { sourcePage } : {}), folderTitle: line };
  const between = values.slice(1, categoryIndex);
  const dates = between.length >= 2 ? parseYearRange(between[between.length - 1]) : parseYearRange('');
  const hasDates = dates.dateRangeUnknown || !!dates.dateFrom;
  return {
    ...emptyScanRow(), ...(sourcePage ? { sourcePage } : {}),
    folderSignature: values[0],
    folderTitle: (hasDates ? between.slice(0, -1) : between).join(' '),
    categoryCode: values[categoryIndex],
    ...dates,
  };
}

function isVisualTableHeader(line: string): boolean {
  const normalized = normalizeHeader(line);
  return normalized.includes('znak teczki') && normalized.includes('tytul teczki') && normalized.includes('kat akt');
}

const VISUAL_ROW_START = /^\d{1,4}[.)]?\s+(\S+)\s+(.+)$/;
const VISUAL_ROW_END = /^(.*?)\s+(?:(brak\s+dat|\d{4}(?:\s*[-–—]\s*\d{4})?)\s+)?((?:A|BE|BC|B)\d*(?:\+\d+)?)\s+\d+\s*$/i;

function visualRow(signature: string, content: string, sourcePage?: number): ScanRow | null {
  const match = content.match(VISUAL_ROW_END);
  if (!match || !match[1].trim()) return null;
  const categoryCode = match[3];
  if (!categoryCode || !CATEGORY.test(categoryCode)) return null;
  const dates = parseYearRange(match[2] || '');
  return {
    ...emptyScanRow(), ...(sourcePage ? { sourcePage } : {}),
    folderSignature: signature, folderTitle: match[1].trim(), categoryCode,
    ...dates,
  };
}

function parsePage(text: string, sourcePage: number | undefined, initialHeader: Header | null, initialVisualTable = false) {
  const rows: ScanRow[] = [];
  let header = initialHeader;
  let visualTable = initialVisualTable;
  const hasVisualHeader = text.split(/\r?\n/).some((line) => !/[;\t]/.test(line) && isVisualTableHeader(line));
  let pending: { signature: string; content: string } | null = null;
  const flushPending = () => {
    if (!pending) return;
    rows.push(visualRow(pending.signature, pending.content, sourcePage) || {
      ...emptyScanRow(), ...(sourcePage ? { sourcePage } : {}),
      folderSignature: pending.signature, folderTitle: pending.content,
    });
    pending = null;
  };
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const { cells, delimited } = splitCells(line);
    const detected = detectHeader(cells);
    if (detected) { flushPending(); header = detected; visualTable = !delimited; continue; }
    if (!delimited && isVisualTableHeader(line)) { flushPending(); visualTable = true; continue; }
    if (hasVisualHeader && !visualTable) continue;
    if (visualTable && !delimited) {
      if (/^(?:Przekazuj[aą]cy akta|Kierownik Kom[oó]rki|Przyjmuj[aą]cy akta|Imi[eę] i nazwisko)/i.test(line)) {
        flushPending();
        break;
      }
      if (/^\d+(?:\s+\d+){3,}\s*$/.test(line)) continue;
      const start = line.match(VISUAL_ROW_START);
      if (start && !/^\d+$/.test(start[1]) && !CATEGORY.test(start[1])) {
        flushPending();
        pending = { signature: start[1], content: start[2] };
      } else if (pending) {
        pending.content += ` ${line}`;
      }
      if (pending && visualRow(pending.signature, pending.content, sourcePage)) flushPending();
      if (rows.length > 500) break;
      continue;
    }

    const categoryIndex = header?.indexOf('categoryCode') ?? -1;
    const signatureIndex = header?.indexOf('folderSignature') ?? -1;
    const titleIndex = header?.indexOf('folderTitle') ?? -1;
    const continuation = titleIndex >= 0 && !!cells[titleIndex] && signatureIndex >= 0 && !cells[signatureIndex];
    const aligned = delimited || (cells.length === header?.length && categoryIndex >= 0 && CATEGORY.test(cells[categoryIndex]));
    if (header && aligned && cells.length <= header.length && (cells.length > categoryIndex || continuation)) {
      const row = mappedRow(cells, header, sourcePage);
      if (!row.folderSignature && row.folderTitle && !row.categoryCode && !row.dateFrom && !row.dateTo && !row.dateRangeUnknown && !row.boxNumber && rows.at(-1)?.folderSignature && rows.at(-1)?.categoryCode) {
        rows[rows.length - 1].folderTitle += ` ${row.folderTitle}`;
        continue;
      }
      rows.push(row);
    } else if (/^\s{2,}\S/.test(rawLine) && cells.length === 1 && rows.at(-1)?.folderSignature && rows.at(-1)?.categoryCode) {
      rows[rows.length - 1].folderTitle += ` ${line}`;
    } else {
      rows.push(fallbackRow(cells, line, sourcePage));
    }
    if (rows.length > 500) break;
  }
  flushPending();
  return { rows, header, visualTable };
}

export function draftScanRows(text: string, sourcePage?: number): ScanRow[] {
  return parsePage(text, sourcePage, null).rows;
}

export function draftScanPages(pageTexts: string[], emptyPages: number[]) {
  const rows: ScanRow[] = [];
  let header: Header | null = null;
  let visualTable = false;
  for (const [index, text] of pageTexts.entries()) {
    if (emptyPages.includes(index + 1)) continue;
    const parsed = parsePage(text, index + 1, header, visualTable);
    header = parsed.header;
    visualTable = parsed.visualTable;
    if (!parsed.rows.length) return { rows: [], missingPage: index + 1, tooMany: false };
    rows.push(...parsed.rows);
    if (rows.length > 500) return { rows: [], missingPage: null, tooMany: true };
  }
  return { rows, missingPage: null, tooMany: false };
}
