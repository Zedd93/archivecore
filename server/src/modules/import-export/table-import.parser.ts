import * as XLSX from 'xlsx';
import { z } from 'zod';
import { normalizeDisplayText } from '@archivecore/shared';

export const BOX_IMPORT_FIELDS = ['title', 'docType', 'department', 'description', 'notes'] as const;
export const HR_IMPORT_FIELDS = [
  'employeeFirstName', 'employeeLastName', 'employeePesel', 'employeeIdNumber',
  'department', 'position', 'employmentStart', 'employmentStatus', 'retentionPeriod', 'storageForm',
] as const;

export type TableImportKind = 'boxes' | 'hr';
export interface TableImportOptions {
  sheetName: string;
  headerRow: number;
  columns: Record<string, string>;
}

const FIELDS: Record<TableImportKind, readonly string[]> = { boxes: BOX_IMPORT_FIELDS, hr: HR_IMPORT_FIELDS };
const REQUIRED: Record<TableImportKind, readonly string[]> = {
  boxes: ['title'],
  hr: ['employeeFirstName', 'employeeLastName', 'employeePesel'],
};

export function parseTableImportOptions(value: unknown, kind: TableImportKind): TableImportOptions | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  let input: unknown;
  try { input = typeof value === 'string' ? JSON.parse(value) : value; }
  catch { throw Object.assign(new Error('Nieprawidłowe mapowanie kolumn'), { statusCode: 400 }); }
  const schema = z.object({
    sheetName: z.string().min(1).max(255),
    headerRow: z.number().int().min(1).max(10000),
    columns: z.record(z.string()),
  }).strict().superRefine((options, ctx) => {
    const entries = Object.entries(options.columns);
    if (entries.length === 0 || entries.length > 50 || entries.some(([index]) => !/^(0|[1-9]|[1-4]\d)$/.test(index))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Nieprawidłowe indeksy kolumn' });
    }
    const fields = entries.map(([, field]) => field);
    if (fields.some((field) => !FIELDS[kind].includes(field))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Nieznane pole importu' });
    }
    if (new Set(fields).size !== fields.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Jedno pole może być przypisane tylko do jednej kolumny' });
    }
    for (const field of REQUIRED[kind]) {
      if (!fields.includes(field)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Wymagane mapowanie pola ${field}` });
    }
  });
  const result = schema.safeParse(input);
  if (!result.success) throw Object.assign(new Error(result.error.issues[0]?.message || 'Nieprawidłowe mapowanie kolumn'), { statusCode: 400 });
  return result.data;
}

function sheetRows(sheet: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json(sheet, { header: 1, range: 0, defval: '', blankrows: true, raw: false }) as unknown[][];
}

export function inspectTableImport(buffer: Buffer, aliases: Record<string, string>, kind: TableImportKind) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  return workbook.SheetNames.map((sheetName) => {
    const rows = sheetRows(workbook.Sheets[sheetName]);
    const detectedIndex = rows.findIndex((row) => {
      const fields = new Set(row.map((cell) => aliases[String(cell ?? '').toLowerCase().trim()]));
      return REQUIRED[kind].every((field) => fields.has(field));
    });
    return {
      sheetName,
      detectedHeaderRow: detectedIndex < 0 ? null : detectedIndex + 1,
      rows: rows.slice(0, 50).map((cells, index) => ({
        rowNumber: index + 1,
        cells: cells.slice(0, 50).map((cell) => normalizeDisplayText(cell).slice(0, 100)),
      })),
    };
  });
}

export function parseMappedTableRows(buffer: Buffer, options: TableImportOptions) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  if (!workbook.SheetNames.includes(options.sheetName)) {
    throw Object.assign(new Error('Nie znaleziono wybranego arkusza'), { statusCode: 400 });
  }
  const rows = sheetRows(workbook.Sheets[options.sheetName]);
  if (options.headerRow > rows.length) {
    throw Object.assign(new Error('Nie znaleziono wybranego wiersza nagłówka'), { statusCode: 400 });
  }
  return rows.slice(options.headerRow).flatMap((cells, index) => {
    if (!cells.some((cell) => String(cell ?? '').trim())) return [];
    const row: Record<string, string | undefined> = {};
    for (const [column, field] of Object.entries(options.columns)) {
      const value = String(cells[Number(column)] ?? '').trim();
      row[field] = value || undefined;
    }
    return [{ row, sourceRow: options.headerRow + index + 1 }];
  });
}
