export interface ScanRow {
  id: string;
  folderSignature: string;
  folderTitle: string;
  categoryCode: string;
  uncertainCategory?: string;
  folderCount: string;
  uncertainFolderCount?: string;
  dateFrom: string;
  dateTo: string;
  uncertainDateRange?: string;
  uncertainDateFrom?: string;
  uncertainDateTo?: string;
  dateRangeUnknown: boolean;
  sourcePage?: number;
  sourceOrdinal?: number;
  sourceOrdinalExpected?: boolean;
  boxNumber: string;
  notes: string;
}

type ScanField = 'sourceOrdinal' | 'folderSignature' | 'folderTitle' | 'categoryCode' | 'folderCount' | 'dateRange' | 'dateFrom' | 'dateTo' | 'boxNumber';
type Header = (ScanField | null)[];

const HEADER_FIELDS: Record<string, ScanField> = {
  lp: 'sourceOrdinal', 'l p': 'sourceOrdinal', 'liczba porzadkowa': 'sourceOrdinal',
  'znak teczki': 'folderSignature', sygnatura: 'folderSignature', sygn: 'folderSignature',
  'tytul teczki': 'folderTitle', 'tytul teczki lub tomu': 'folderTitle', 'tytul teczki tomu': 'folderTitle', tytul: 'folderTitle',
  'daty skrajne': 'dateRange', 'daty skrajne od do': 'dateRange',
  'daty skrajne od': 'dateFrom', 'daty skrajne do': 'dateTo',
  'data od': 'dateFrom', 'data do': 'dateTo',
  'kat akt': 'categoryCode', kategoria: 'categoryCode', 'kategoria akt': 'categoryCode',
  'liczba teczek': 'folderCount', 'liczba teczek akt': 'folderCount', 'ilosc teczek': 'folderCount',
  'numer kartonu': 'boxNumber', 'nr kartonu': 'boxNumber', karton: 'boxNumber',
};
const CATEGORY = /^(?:A|BE|Bc|B)\d*(?:\+\d+)?$/i;

export const emptyScanRow = (): ScanRow => ({
  id: crypto.randomUUID(), folderSignature: '', folderTitle: '', categoryCode: '', folderCount: '1', dateFrom: '', dateTo: '', dateRangeUnknown: false, boxNumber: '', notes: '',
});

export function validFolderCount(value: string): boolean {
  return /^[1-9]\d*$/.test(value.trim()) && Number(value) <= 2147483647;
}

export function validScanBoxNumber(value: string): boolean {
  return value.trim().length <= 100;
}

export function scanBoxNumbers(rows: ScanRow[]): string[] {
  return [...new Set(rows.map((row) => row.boxNumber.trim()).filter(Boolean))];
}

export function scanOrdinalIssues(rows: ScanRow[]) {
  const gaps: { from: number; to: number }[] = [];
  const duplicates = new Set<number>();
  const seen = new Set<number>();
  const unreadableRows: number[] = [];
  const outOfOrderRows: number[] = [];
  let previousOrdinal: number | undefined;
  for (const [index, row] of rows.entries()) {
    const ordinal = row.sourceOrdinal;
    if (ordinal === undefined) {
      if (row.sourceOrdinalExpected && row.folderSignature.trim()) unreadableRows.push(index + 1);
      continue;
    }
    if (seen.has(ordinal)) duplicates.add(ordinal);
    if (previousOrdinal !== undefined && ordinal < previousOrdinal) outOfOrderRows.push(index + 1);
    seen.add(ordinal);
    previousOrdinal = ordinal;
  }
  const ordered = [...seen].sort((a, b) => a - b);
  if (ordered.length && ordered[0] > 1) gaps.push({ from: 1, to: ordered[0] - 1 });
  for (let index = 1; index < ordered.length; index++) {
    if (ordered[index] > ordered[index - 1] + 1) gaps.push({ from: ordered[index - 1] + 1, to: ordered[index] - 1 });
  }
  return { gaps, duplicates: [...duplicates].sort((a, b) => a - b), unreadableRows, outOfOrderRows };
}

export type ScanOrdinalLocation = {
  kind: 'gap' | 'duplicate' | 'unreadable' | 'outOfOrder';
  value: string;
  row: number;
  page?: number;
};

export function scanOrdinalIssueLocations(rows: ScanRow[]): ScanOrdinalLocation[] {
  const issues = scanOrdinalIssues(rows);
  const location = (kind: ScanOrdinalLocation['kind'], value: string, index: number): ScanOrdinalLocation => ({
    kind, value, row: index + 1, ...(rows[index].sourcePage ? { page: rows[index].sourcePage } : {}),
  });
  return [
    ...issues.gaps.map(({ from, to }) => {
      const index = rows.findIndex((row) => row.sourceOrdinal !== undefined && row.sourceOrdinal > to);
      return location('gap', from === to ? String(from) : `${from}-${to}`, index);
    }),
    ...issues.duplicates.flatMap((number) => rows.flatMap((row, index) => row.sourceOrdinal === number ? [location('duplicate', String(number), index)] : [])),
    ...issues.unreadableRows.map((row) => location('unreadable', String(row), row - 1)),
    ...issues.outOfOrderRows.map((row) => location('outOfOrder', String(row), row - 1)),
  ];
}

export function needsScanDateReview(row: ScanRow): boolean {
  if (row.dateRangeUnknown) return false;
  return !!((row.uncertainDateRange && (!row.dateFrom || !row.dateTo))
    || (row.uncertainDateFrom && !row.dateFrom)
    || (row.uncertainDateTo && !row.dateTo));
}

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

function parseOrdinal(value: string): number | undefined {
  const match = value.trim().match(/^([1-9]\d{0,3})[.)]?$/);
  return match ? Number(match[1]) : undefined;
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
  const categoryCode = fields.categoryCode || '';
  const rawDateRange = fields.dateRange || '';
  const rawDateFrom = fields.dateFrom || '';
  const rawDateTo = fields.dateTo || '';
  const folderCount = fields.folderCount ?? '1';
  const dates = parseYearRange(rawDateRange);
  const dateRangeUnknown = dates.dateRangeUnknown || [fields.dateFrom, fields.dateTo].some((value) => /^brak\s+dat$/i.test(value || ''));
  const parsedDateFrom = parseDateCell(rawDateFrom, false);
  const parsedDateTo = parseDateCell(rawDateTo, true);
  const sourceOrdinal = parseOrdinal(fields.sourceOrdinal || '');
  return {
    ...emptyScanRow(),
    ...(sourcePage ? { sourcePage } : {}),
    ...(sourceOrdinal !== undefined ? { sourceOrdinal } : {}),
    ...(header.includes('sourceOrdinal') ? { sourceOrdinalExpected: true } : {}),
    folderSignature: fields.folderSignature || '',
    folderTitle: fields.folderTitle || '',
    categoryCode: CATEGORY.test(categoryCode) ? categoryCode : '',
    ...(categoryCode && !CATEGORY.test(categoryCode) ? { uncertainCategory: categoryCode } : {}),
    folderCount,
    ...(folderCount && !validFolderCount(folderCount) ? { uncertainFolderCount: folderCount } : {}),
    boxNumber: fields.boxNumber || '',
    dateFrom: dateRangeUnknown ? '' : parsedDateFrom || dates.dateFrom,
    dateTo: dateRangeUnknown ? '' : parsedDateTo || dates.dateTo,
    ...(rawDateRange && !dates.dateFrom && !dateRangeUnknown ? { uncertainDateRange: rawDateRange } : {}),
    ...(rawDateFrom && !parsedDateFrom && !dateRangeUnknown ? { uncertainDateFrom: rawDateFrom } : {}),
    ...(rawDateTo && !parsedDateTo && !dateRangeUnknown ? { uncertainDateTo: rawDateTo } : {}),
    dateRangeUnknown,
  };
}

function fallbackRow(cells: string[], line: string, sourcePage?: number, sourceOrdinalExpected = false): ScanRow {
  const values = cells.filter(Boolean);
  const sourceOrdinal = values.length > 1 ? parseOrdinal(values[0]) : undefined;
  if (sourceOrdinal !== undefined) values.shift();
  const categoryIndex = values.findIndex((cell, index) => index >= 2 && CATEGORY.test(cell));
  if (categoryIndex < 0) return { ...emptyScanRow(), ...(sourcePage ? { sourcePage } : {}), ...(sourceOrdinal !== undefined ? { sourceOrdinal } : {}), ...(sourceOrdinalExpected ? { sourceOrdinalExpected } : {}), folderTitle: line };
  const between = values.slice(1, categoryIndex);
  const dates = between.length >= 2 ? parseYearRange(between[between.length - 1]) : parseYearRange('');
  const hasDates = dates.dateRangeUnknown || !!dates.dateFrom;
  return {
    ...emptyScanRow(), ...(sourcePage ? { sourcePage } : {}), ...(sourceOrdinal !== undefined ? { sourceOrdinal } : {}), ...(sourceOrdinalExpected ? { sourceOrdinalExpected } : {}),
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

const VISUAL_ROW_START = /^(\d{1,4})[.)]?\s+(\S+)\s+(.+)$/;
const VISUAL_ROW_END = /^(.*?)\s+(?:(brak\s+dat|[0-9OIl]{4}(?:\s*[-–—]\s*[0-9OIl]{4})?)\s+)?([AB][A-Z0-9+]{0,6})\s+(\d+|[lIoO?])\s*$/i;

function visualRow(sourceOrdinal: number | undefined, signature: string, content: string, sourcePage: number | undefined, sourceOrdinalExpected: boolean): ScanRow | null {
  const match = content.match(VISUAL_ROW_END);
  if (!match || !match[1].trim()) return null;
  const categoryCode = match[3];
  const rawDateRange = match[2] || '';
  const folderCount = match[4];
  const dates = parseYearRange(rawDateRange);
  return {
    ...emptyScanRow(), ...(sourcePage ? { sourcePage } : {}), ...(sourceOrdinal !== undefined ? { sourceOrdinal } : {}), ...(sourceOrdinalExpected ? { sourceOrdinalExpected } : {}),
    folderSignature: signature, folderTitle: match[1].replace(/(?:^|\s)\|(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim(),
    categoryCode: CATEGORY.test(categoryCode) ? categoryCode : '',
    ...(!CATEGORY.test(categoryCode) ? { uncertainCategory: categoryCode } : {}),
    folderCount,
    ...(folderCount && !validFolderCount(folderCount) ? { uncertainFolderCount: folderCount } : {}),
    ...(rawDateRange && !dates.dateFrom && !dates.dateRangeUnknown ? { uncertainDateRange: rawDateRange } : {}),
    ...dates,
  };
}

function parsePage(text: string, sourcePage: number | undefined, initialHeader: Header | null, initialVisualTable = false, initialVisualOrdinalExpected = false) {
  const rows: ScanRow[] = [];
  let header = initialHeader;
  let visualTable = initialVisualTable;
  let visualOrdinalExpected = initialVisualOrdinalExpected;
  const hasVisualHeader = text.split(/\r?\n/).some((line) => !/[;\t]/.test(line) && isVisualTableHeader(line));
  let pending: { sourceOrdinal?: number; signature: string; content: string } | null = null;
  let canContinueVisualRow = false;
  const flushPending = () => {
    if (!pending) return;
    const parsed = visualRow(pending.sourceOrdinal, pending.signature, pending.content, sourcePage, visualOrdinalExpected);
    rows.push(parsed || {
      ...emptyScanRow(), ...(sourcePage ? { sourcePage } : {}), ...(pending.sourceOrdinal !== undefined ? { sourceOrdinal: pending.sourceOrdinal } : {}), ...(visualOrdinalExpected ? { sourceOrdinalExpected: true } : {}),
      folderSignature: pending.signature, folderTitle: pending.content,
    });
    canContinueVisualRow = !!parsed;
    pending = null;
  };
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const { cells, delimited } = splitCells(line);
    const detected = detectHeader(cells);
    if (detected) { flushPending(); header = detected; visualTable = !delimited; visualOrdinalExpected = visualTable && detected.includes('sourceOrdinal'); continue; }
    if (!delimited && isVisualTableHeader(line)) { flushPending(); visualTable = true; visualOrdinalExpected = /(?:^|\s)lp(?:\s|$)/.test(normalizeHeader(line)); continue; }
    if (hasVisualHeader && !visualTable) continue;
    if (visualTable && !delimited) {
      if (/^(?:Przekazuj[aą]cy akta|Kierownik Kom[oó]rki|Przyjmuj[aą]cy akta|Imi[eę] i nazwisko)/i.test(line)) {
        flushPending();
        break;
      }
      if (/^\d+(?:\s+\d+){3,}\s*$/.test(line)) continue;
      const start = line.match(VISUAL_ROW_START);
      const unnumberedStart = visualOrdinalExpected ? line.match(/^(?:\S{1,4}\s+)?(\S*\/\S+)\s+(.+)$/) : null;
      if (start && Number(start[1]) > 0 && !/^\d+$/.test(start[2]) && !CATEGORY.test(start[2])) {
        flushPending();
        pending = { sourceOrdinal: Number(start[1]), signature: start[2], content: start[3] };
      } else if (unnumberedStart) {
        flushPending();
        pending = { signature: unnumberedStart[1], content: unnumberedStart[2] };
      } else if (pending) {
        pending.content += ` ${line}`;
      } else if (canContinueVisualRow && /^[\p{L}][\p{L}\p{M}\s–—-]{0,79}$/u.test(line)) {
        rows[rows.length - 1].folderTitle += ` ${line}`;
      }
      if (pending && visualRow(pending.sourceOrdinal, pending.signature, pending.content, sourcePage, visualOrdinalExpected)) flushPending();
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
      rows.push(fallbackRow(cells, line, sourcePage, !!header?.includes('sourceOrdinal')));
    }
    if (rows.length > 500) break;
  }
  flushPending();
  return { rows, header, visualTable, visualOrdinalExpected };
}

export function draftScanRows(text: string, sourcePage?: number): ScanRow[] {
  return parsePage(text, sourcePage, null).rows;
}

export function draftScanPages(pageTexts: string[], emptyPages: number[]) {
  const rows: ScanRow[] = [];
  let header: Header | null = null;
  let visualTable = false;
  let visualOrdinalExpected = false;
  for (const [index, text] of pageTexts.entries()) {
    if (emptyPages.includes(index + 1)) continue;
    const parsed = parsePage(text, index + 1, header, visualTable, visualOrdinalExpected);
    header = parsed.header;
    visualTable = parsed.visualTable;
    visualOrdinalExpected = parsed.visualOrdinalExpected;
    if (!parsed.rows.length) return { rows: [], missingPage: index + 1, tooMany: false };
    rows.push(...parsed.rows);
    if (rows.length > 500) return { rows: [], missingPage: null, tooMany: true };
  }
  return { rows, missingPage: null, tooMany: false };
}
