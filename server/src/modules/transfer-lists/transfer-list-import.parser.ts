import * as XLSX from 'xlsx';
import { z } from 'zod';
import { normalizeDisplayText } from '@archivecore/shared';

const MANUAL_FIELDS = [
  'folderSignature', 'folderTitle', 'dateFrom', 'dateTo', '_dateRange',
  'categoryCode', 'folderCount', 'storageLocation', 'disposalOrTransferDate',
  'boxNumber', 'notes',
] as const;

const manualOptionsSchema = z.object({
  sheetName: z.string().min(1).max(255),
  headerRow: z.number().int().min(1).max(10000),
  columns: z.record(z.enum(MANUAL_FIELDS)),
}).strict().superRefine((value, ctx) => {
  const entries = Object.entries(value.columns);
  if (entries.length === 0 || entries.length > 50 || entries.some(([key]) => !/^(0|[1-9]\d?)$/.test(key))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Nieprawidłowe indeksy kolumn' });
  }
  const fields = entries.map(([, field]) => field);
  if (new Set(fields).size !== fields.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Jedno pole może być przypisane tylko do jednej kolumny' });
  }
  for (const required of ['folderSignature', 'folderTitle', 'categoryCode']) {
    if (!fields.includes(required as typeof MANUAL_FIELDS[number])) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Wymagane mapowanie pola ${required}` });
    }
  }
  if (fields.includes('_dateRange') && (fields.includes('dateFrom') || fields.includes('dateTo'))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Wybierz zakres dat albo osobne kolumny dat' });
  }
});

export type TransferListImportOptions = z.infer<typeof manualOptionsSchema>;

export function parseTransferListImportOptions(value: unknown): TransferListImportOptions | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  let parsed: unknown;
  try { parsed = typeof value === 'string' ? JSON.parse(value) : value; }
  catch { throw Object.assign(new Error('Nieprawidłowe mapowanie kolumn'), { statusCode: 400 }); }
  const result = manualOptionsSchema.safeParse(parsed);
  if (!result.success) {
    throw Object.assign(new Error(result.error.issues[0]?.message || 'Nieprawidłowe mapowanie kolumn'), { statusCode: 400 });
  }
  return result.data;
}

const TRANSFER_LIST_COLUMN_MAP: Record<string, string> = {
  'lp': '_ordinal',
  'l p': '_ordinal',
  'nr': '_ordinal',
  'znak teczki': 'folderSignature',
  'sygnatura': 'folderSignature',
  'sygn': 'folderSignature',
  'tytuł teczki': 'folderTitle',
  'tytul teczki': 'folderTitle',
  'tytuł teczki lub tomu': 'folderTitle',
  'tytul teczki lub tomu': 'folderTitle',
  'tytuł teczki tomu': 'folderTitle',
  'tytul teczki tomu': 'folderTitle',
  'tytuł': 'folderTitle',
  'tytul': 'folderTitle',
  'nazwa': 'folderTitle',
  'data od': 'dateFrom',
  'daty skrajne od': 'dateFrom',
  'od': 'dateFrom',
  'roczniki od': 'dateFrom',
  'data do': 'dateTo',
  'daty skrajne do': 'dateTo',
  'do': 'dateTo',
  'roczniki do': 'dateTo',
  'daty skrajne': '_dateRange',
  'daty skrajne od do': '_dateRange',
  'daty skrajne oddo': '_dateRange',
  'daty': '_dateRange',
  'kat akt': 'categoryCode',
  'kat': 'categoryCode',
  'kategoria': 'categoryCode',
  'kategoria akt': 'categoryCode',
  'kategoria archiwalna': 'categoryCode',
  'liczba teczek': 'folderCount',
  'ilość': 'folderCount',
  'ilosc': 'folderCount',
  'ilość teczek': 'folderCount',
  'ilosc teczek': 'folderCount',
  'liczba': 'folderCount',
  'l teczek': 'folderCount',
  'miejsce przechowywania': 'storageLocation',
  'miejsce przechowywania akt': 'storageLocation',
  'miejsce przechowywania akt w archiwum': 'storageLocation',
  'lokalizacja': 'storageLocation',
  'data zniszczenia': 'disposalOrTransferDate',
  'data zniszczenia lub przekazania': 'disposalOrTransferDate',
  'data zniszczenia lub przekazania do archiwum państwowego': 'disposalOrTransferDate',
  'data zniszczenia lub przekazania do archiwum panstwowego': 'disposalOrTransferDate',
  'data przekazania': 'disposalOrTransferDate',
  'numer kartonu': 'boxNumber',
  'nr kartonu': 'boxNumber',
  'karton': 'boxNumber',
  'box number': 'boxNumber',
  'uwagi': 'notes',
  'notatki': 'notes',
  'folder signature': 'folderSignature',
  'signature': 'folderSignature',
  'folder title': 'folderTitle',
  'title': 'folderTitle',
  'date from': 'dateFrom',
  'date to': 'dateTo',
  'category': 'categoryCode',
  'category code': 'categoryCode',
  'folder count': 'folderCount',
  'count': 'folderCount',
  'storage location': 'storageLocation',
  'location': 'storageLocation',
  'disposal date': 'disposalOrTransferDate',
  'transfer date': 'disposalOrTransferDate',
  'notes': 'notes',
};

function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/(?<=\p{L})[-‑‐](?=\p{L})/gu, '')
    .replace(/[–—-]+/g, ' ')
    .replace(/[.,:;]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getWorksheetRows(sheet: XLSX.WorkSheet): any[][] {
  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    range: 0,
    defval: '',
    blankrows: true,
    raw: true,
  }) as any[][];
}

function detectHeaderRow(rows: any[][]): { headerIndex: number; headerMap: Record<number, string> } | null {
  for (let headerIndex = 0; headerIndex < rows.length; headerIndex++) {
    const headerMap: Record<number, string> = {};
    const fields = new Set<string>();

    rows[headerIndex].forEach((cell, columnIndex) => {
      const field = TRANSFER_LIST_COLUMN_MAP[normalizeHeader(cell)];
      if (field) {
        headerMap[columnIndex] = field;
        fields.add(field);
      }
    });

    if (fields.has('folderSignature') && fields.has('folderTitle') && fields.has('categoryCode')) {
      return { headerIndex, headerMap };
    }
  }

  return null;
}

function selectTransferListSheet(workbook: XLSX.WorkBook) {
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = getWorksheetRows(sheet);
    if (rows.length === 0) continue;
    const header = detectHeaderRow(rows);
    if (header) return { sheetName, rows, ...header };
  }

  return null;
}

export function inspectTransferListImport(buffer: Buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  return workbook.SheetNames.map((sheetName) => {
    const rows = getWorksheetRows(workbook.Sheets[sheetName]);
    const detected = detectHeaderRow(rows);
    return {
      sheetName,
      detectedHeaderRow: detected ? detected.headerIndex + 1 : null,
      rows: rows.slice(0, 50).map((cells, index) => ({
        rowNumber: index + 1,
        cells: cells.slice(0, 50).map((cell) => normalizeDisplayText(cell).slice(0, 100)),
      })),
    };
  });
}

function parseDate(val: any): string | null {
  if (val === null || val === undefined || val === '') return null;
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    return val.toISOString().split('T')[0];
  }
  if (typeof val === 'number' && Number.isInteger(val) && val >= 1000 && val <= 3000) {
    return `${val}-01-01`;
  }
  if (typeof val === 'number' && val > 1000 && val < 100000) {
    try {
      const date = new Date((val - 25569) * 86400 * 1000);
      if (!isNaN(date.getTime())) return date.toISOString().split('T')[0];
    } catch { /* fall through */ }
  }

  const s = String(val).trim();
  if (!s || /^brak\s+dat$/i.test(s)) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if (/^\d{4}$/.test(s)) return `${s}-01-01`;
  const ym = s.match(/^(\d{4})[./](\d{1,2})$/);
  if (ym) return `${ym[1]}-${ym[2].padStart(2, '0')}-01`;
  return null;
}

function parseDateRange(val: any): { from: string | null; to: string | null } {
  if (val === null || val === undefined || val === '') return { from: null, to: null };
  const s = String(val).trim();
  if (!s || /^brak\s+dat$/i.test(s)) return { from: null, to: null };

  const year = s.match(/^(\d{4})$/);
  if (year) return { from: `${year[1]}-01-01`, to: `${year[1]}-12-31` };

  const yearRange = s.match(/^(\d{4})\s*[-–—]\s*(\d{4})$/);
  if (yearRange) return { from: `${yearRange[1]}-01-01`, to: `${yearRange[2]}-12-31` };

  const parts = s.split(/\s*[-–—]\s*/);
  if (parts.length === 2) {
    return { from: parseDate(parts[0]), to: parseDate(parts[1]) };
  }

  return { from: parseDate(s), to: null };
}

function isColumnNumberingRow(mapped: any): boolean {
  return /^\d+$/.test(String(mapped.folderSignature ?? '').trim())
    && /^\d+$/.test(String(mapped.folderTitle ?? '').trim())
    && /^\d+$/.test(String(mapped.categoryCode ?? '').trim());
}

export function parseTransferListImport(buffer: Buffer, options?: TransferListImportOptions) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const selected = options ? (() => {
    const sheet = workbook.Sheets[options.sheetName];
    if (!sheet) throw Object.assign(new Error('Nie znaleziono wybranego arkusza'), { statusCode: 400 });
    const rows = getWorksheetRows(sheet);
    if (options.headerRow > rows.length) throw Object.assign(new Error('Nie znaleziono wybranego wiersza nagłówka'), { statusCode: 400 });
    return {
      sheetName: options.sheetName,
      rows,
      headerIndex: options.headerRow - 1,
      headerMap: Object.fromEntries(Object.entries(options.columns).map(([index, field]) => [Number(index), field])),
    };
  })() : selectTransferListSheet(workbook);
  if (!selected) {
    throw Object.assign(new Error('Nie rozpoznano arkusza ze spisem zdawczo-odbiorczym. Oczekiwane nagłówki to m.in. "Znak teczki", "Tytuł teczki lub tomu", "Kat. akt".'), { statusCode: 400 });
  }

  const errors: { row: number; message: string }[] = [];
  const parsedRows = selected.rows.slice(selected.headerIndex + 1).map((row, rowIndex) => {
    const mapped: any = {};
    for (const [columnIndex, fieldName] of Object.entries(selected.headerMap)) {
      mapped[fieldName] = row[Number(columnIndex)];
    }

    if (isColumnNumberingRow(mapped)) return null;

    if (mapped._dateRange && !mapped.dateFrom && !mapped.dateTo) {
      const range = parseDateRange(mapped._dateRange);
      mapped.dateFrom = range.from;
      mapped.dateTo = range.to;
    }

    const folderSignature = normalizeDisplayText(mapped.folderSignature).trim();
    const folderTitle = normalizeDisplayText(mapped.folderTitle).trim();
    const categoryCode = normalizeDisplayText(mapped.categoryCode).trim();

    if (!folderSignature && !folderTitle) {
      if (options && Object.values(mapped).some((value) => String(value ?? '').trim())) {
        errors.push({ row: selected.headerIndex + rowIndex + 2, message: 'Brak znaku i tytułu teczki' });
      }
      return null;
    }
    if (normalizeHeader(folderSignature) === 'znak teczki' || normalizeHeader(folderTitle).startsWith('tytuł teczki')) return null;
    if (options && (!folderSignature || !folderTitle || !categoryCode)) {
      errors.push({ row: selected.headerIndex + rowIndex + 2, message: 'Brak znaku, tytułu lub kategorii teczki' });
      return null;
    }

    const boxNumber = String(mapped.boxNumber ?? '').trim();

    return {
      _sourceRow: selected.headerIndex + rowIndex + 2,
      folderSignature: folderSignature || `Poz. ${rowIndex + 1}`,
      folderTitle: folderTitle || 'Bez tytułu',
      dateFrom: parseDate(mapped.dateFrom),
      dateTo: parseDate(mapped.dateTo),
      categoryCode: categoryCode || 'B10',
      folderCount: Math.max(1, parseInt(String(mapped.folderCount), 10) || 1),
      storageLocation: mapped.storageLocation ? normalizeDisplayText(mapped.storageLocation).trim() || null : null,
      disposalOrTransferDate: parseDate(mapped.disposalOrTransferDate),
      boxNumber: boxNumber || null,
      notes: mapped.notes ? normalizeDisplayText(mapped.notes).trim() || null : null,
    };
  }).filter((item: any) => item !== null);

  const rowNumbers = parsedRows.map((item: any) => item._sourceRow as number);
  const items = parsedRows.map((item: any) => {
    const { _sourceRow, ...data } = item;
    return data;
  });

  return {
    sheetName: selected.sheetName,
    headerRow: selected.headerIndex + 1,
    items,
    rowNumbers,
    errors,
  };
}
