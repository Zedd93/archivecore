import * as XLSX from 'xlsx';
import { z } from 'zod';
import { prisma } from '../../config/database';
import { generateQrData } from '@archivecore/shared';
import { encryptAES256, hmacSha256 } from '../../utils/crypto';

// ─── Row validation schemas (relaxed versions for import) ─

const boxImportRowSchema = z.object({
  title: z.string().min(1, 'Tytuł jest wymagany').max(500),
  docType: z.string().max(100).optional(),
  description: z.string().optional(),
  notes: z.string().optional(),
});

const hrImportRowSchema = z.object({
  employeeFirstName: z.string().min(1, 'Imię jest wymagane').max(100),
  employeeLastName: z.string().min(1, 'Nazwisko jest wymagane').max(100),
  employeePesel: z.string().length(11, 'PESEL musi mieć 11 znaków').regex(/^\d{11}$/, 'PESEL musi składać się z cyfr'),
  employeeIdNumber: z.string().max(50).optional(),
  department: z.string().max(200).optional(),
  position: z.string().max(200).optional(),
  employmentStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format daty: YYYY-MM-DD').optional(),
  employmentStatus: z.enum(['active', 'terminated', 'retired', 'deceased']).default('active'),
  retentionPeriod: z.enum(['ten_years', 'fifty_years']).default('ten_years'),
  storageForm: z.enum(['paper', 'digital', 'hybrid']).default('paper'),
});

// ─── Column mapping (header → field) ─────────────────────

const BOX_COLUMN_MAP: Record<string, string> = {
  'tytuł': 'title', 'tytul': 'title', 'title': 'title',
  'typ dokumentów': 'docType', 'typ dokumentow': 'docType', 'typ dok.': 'docType', 'doctype': 'docType', 'document type': 'docType',
  'opis': 'description', 'description': 'description',
  'uwagi': 'notes', 'notes': 'notes',
};

const HR_COLUMN_MAP: Record<string, string> = {
  'imię': 'employeeFirstName', 'imie': 'employeeFirstName', 'first name': 'employeeFirstName', 'firstname': 'employeeFirstName',
  'nazwisko': 'employeeLastName', 'last name': 'employeeLastName', 'lastname': 'employeeLastName',
  'pesel': 'employeePesel',
  'nr dowodu': 'employeeIdNumber', 'id number': 'employeeIdNumber', 'nr dokumentu': 'employeeIdNumber',
  'dział': 'department', 'dzial': 'department', 'department': 'department',
  'stanowisko': 'position', 'position': 'position',
  'data zatrudnienia': 'employmentStart', 'employment start': 'employmentStart',
  'status zatrudnienia': 'employmentStatus', 'employment status': 'employmentStatus',
  'okres retencji': 'retentionPeriod', 'retention period': 'retentionPeriod',
  'forma przechowywania': 'storageForm', 'storage form': 'storageForm',
};

// ─── Parse helpers ───────────────────────────────────────

interface ImportResult {
  totalRows: number;
  imported: number;
  errors: { row: number; field?: string; message: string }[];
}

function parseFileToRows(buffer: Buffer, filename: string): Record<string, any>[] {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw Object.assign(new Error('Plik nie zawiera arkuszy'), { statusCode: 400 });

  const sheet = wb.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(sheet, { defval: '' });
}

function mapColumns(rows: Record<string, any>[], columnMap: Record<string, string>): Record<string, any>[] {
  if (rows.length === 0) return [];

  // Build mapping from actual headers to field names
  const headers = Object.keys(rows[0]);
  const mapping: Record<string, string> = {};

  for (const header of headers) {
    const normalized = header.toLowerCase().trim();
    if (columnMap[normalized]) {
      mapping[header] = columnMap[normalized];
    } else {
      // Try direct field name match
      const directMatch = Object.values(columnMap).find(v => v === normalized);
      if (directMatch) {
        mapping[header] = directMatch;
      } else {
        mapping[header] = header; // keep original
      }
    }
  }

  return rows.map(row => {
    const mapped: Record<string, any> = {};
    for (const [originalHeader, value] of Object.entries(row)) {
      const fieldName = mapping[originalHeader] || originalHeader;
      const strVal = String(value ?? '').trim();
      mapped[fieldName] = strVal || undefined;
    }
    return mapped;
  });
}

// ─── Import Service ──────────────────────────────────────

export class ImportService {

  /**
   * Dry-run: parse and validate without inserting
   */
  async previewBoxes(buffer: Buffer, filename: string): Promise<{ rows: any[]; errors: ImportResult['errors'] }> {
    const rawRows = parseFileToRows(buffer, filename);
    const mapped = mapColumns(rawRows, BOX_COLUMN_MAP);
    const errors: ImportResult['errors'] = [];
    const validRows: any[] = [];

    mapped.forEach((row, i) => {
      const result = boxImportRowSchema.safeParse(row);
      if (!result.success) {
        result.error.errors.forEach(e => {
          errors.push({ row: i + 2, field: e.path.join('.'), message: e.message });
        });
      } else {
        validRows.push({ ...result.data, _rowIndex: i + 2 });
      }
    });

    return { rows: validRows, errors };
  }

  async importBoxes(buffer: Buffer, filename: string, tenantId: string, userId: string): Promise<ImportResult> {
    const rawRows = parseFileToRows(buffer, filename);
    const mapped = mapColumns(rawRows, BOX_COLUMN_MAP);
    const errors: ImportResult['errors'] = [];
    let imported = 0;

    // Get tenant for QR code
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw Object.assign(new Error('Tenant nie znaleziony'), { statusCode: 400 });

    // Get current counter
    const year = new Date().getFullYear();
    const lastBox = await prisma.box.findFirst({
      where: { tenantId, boxNumber: { startsWith: `K-${year}-` } },
      orderBy: { boxNumber: 'desc' },
    });
    let counter = lastBox ? parseInt(lastBox.boxNumber.split('-').pop() || '0') : 0;

    for (let i = 0; i < mapped.length; i++) {
      const row = mapped[i];
      const result = boxImportRowSchema.safeParse(row);

      if (!result.success) {
        result.error.errors.forEach(e => {
          errors.push({ row: i + 2, field: e.path.join('.'), message: e.message });
        });
        continue;
      }

      try {
        counter++;
        const boxNumber = `K-${year}-${String(counter).padStart(6, '0')}`;
        const qrCode = generateQrData(tenant.shortCode, boxNumber);

        await prisma.box.create({
          data: {
            boxNumber,
            qrCode,
            title: result.data.title,
            docType: result.data.docType || null,
            description: result.data.description || null,
            notes: result.data.notes || null,
            status: 'active',
            tenantId,
            createdById: userId,
          },
        });
        imported++;
      } catch (err: any) {
        errors.push({ row: i + 2, message: err.message || 'Błąd tworzenia kartonu' });
      }
    }

    return { totalRows: mapped.length, imported, errors };
  }

  /**
   * Preview HR import
   */
  async previewHR(buffer: Buffer, filename: string): Promise<{ rows: any[]; errors: ImportResult['errors'] }> {
    const rawRows = parseFileToRows(buffer, filename);
    const mapped = mapColumns(rawRows, HR_COLUMN_MAP);
    const errors: ImportResult['errors'] = [];
    const validRows: any[] = [];

    mapped.forEach((row, i) => {
      const result = hrImportRowSchema.safeParse(row);
      if (!result.success) {
        result.error.errors.forEach(e => {
          errors.push({ row: i + 2, field: e.path.join('.'), message: e.message });
        });
      } else {
        // Mask PESEL in preview
        const data = { ...result.data };
        if (data.employeePesel) {
          data.employeePesel = data.employeePesel.substring(0, 3) + '********';
        }
        validRows.push({ ...data, _rowIndex: i + 2 });
      }
    });

    return { rows: validRows, errors };
  }

  async importHR(buffer: Buffer, filename: string, tenantId: string, userId: string): Promise<ImportResult> {
    const rawRows = parseFileToRows(buffer, filename);
    const mapped = mapColumns(rawRows, HR_COLUMN_MAP);
    const errors: ImportResult['errors'] = [];
    let imported = 0;

    for (let i = 0; i < mapped.length; i++) {
      const row = mapped[i];
      const result = hrImportRowSchema.safeParse(row);

      if (!result.success) {
        result.error.errors.forEach(e => {
          errors.push({ row: i + 2, field: e.path.join('.'), message: e.message });
        });
        continue;
      }

      try {
        const data = result.data;

        // Check if PESEL already exists (via HMAC hash)
        const employeePeselHmac = hmacSha256(data.employeePesel);
        const existing = await prisma.hRFolder.findFirst({
          where: { tenantId, employeePeselHmac },
        });

        if (existing) {
          errors.push({ row: i + 2, message: `Pracownik z tym PESELem już istnieje (ID: ${existing.id})` });
          continue;
        }

        // Encrypt PESEL
        const employeePesel = encryptAES256(data.employeePesel);

        // Create HR parts (A-E)
        const parts = ['A', 'B', 'C', 'D', 'E'].map((code, idx) => ({
          partCode: code as any,
          description: `Część ${code}`,
          documentCount: 0,
        }));

        await prisma.hRFolder.create({
          data: {
            employeeFirstName: data.employeeFirstName,
            employeeLastName: data.employeeLastName,
            employeePesel,
            employeePeselHmac,
            employeeIdNumber: data.employeeIdNumber || null,
            department: data.department || null,
            position: data.position || null,
            employmentStart: data.employmentStart ? new Date(data.employmentStart) : null,
            employmentStatus: data.employmentStatus,
            retentionPeriod: data.retentionPeriod,
            storageForm: data.storageForm,
            tenantId,
            parts: { create: parts },
          },
        });
        imported++;
      } catch (err: any) {
        errors.push({ row: i + 2, message: err.message || 'Błąd tworzenia akt osobowych' });
      }
    }

    return { totalRows: mapped.length, imported, errors };
  }
}

export const importService = new ImportService();
