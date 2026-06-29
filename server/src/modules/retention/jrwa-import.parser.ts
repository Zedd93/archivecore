import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import { normalizeDisplayText } from '@archivecore/shared';

export interface JrwaImportRow {
  rowNumber: number;
  jrwaCode: string;
  name: string;
  archivalCategory: string;
  retentionYears: number | null;
  isPermanent: boolean;
  requiresReview: boolean;
  docType: string;
  description: string | null;
}

export interface JrwaParseResult {
  rows: JrwaImportRow[];
  skipped: Array<{ rowNumber: number; reason: string }>;
  tableNumber: number;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  trimValues: false,
});

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function collectText(node: any): string {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(collectText).join('');
  if (typeof node !== 'object') return '';

  return Object.entries(node)
    .filter(([key]) => !key.startsWith('@_') && !key.endsWith('Pr'))
    .map(([key, value]) => key === 'w:tab' ? '\t' : key === 'w:br' ? '\n' : collectText(value))
    .join('');
}

function findNodes(node: any, key: string, result: any[] = []): any[] {
  if (Array.isArray(node)) {
    for (const entry of node) findNodes(entry, key, result);
    return result;
  }
  if (!node || typeof node !== 'object') return result;

  for (const [entryKey, value] of Object.entries(node)) {
    if (entryKey === key) result.push(...asArray(value));
    findNodes(value, key, result);
  }
  return result;
}

function normalizeCellText(value: unknown) {
  return normalizeDisplayText(value)
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTables(documentXml: string): string[][][] {
  const parsed = xmlParser.parse(documentXml);
  return findNodes(parsed, 'w:tbl').map((table) => (
    findNodes(table, 'w:tr').map((row) => (
      findNodes(row, 'w:tc').flatMap((cell) => {
        const span = Number.parseInt(cell?.['w:tcPr']?.['w:gridSpan']?.['@_w:val'] || '1', 10);
        const text = normalizeCellText(collectText(cell));
        return Array.from({ length: Number.isFinite(span) ? span : 1 }, () => text);
      })
    ))
  ));
}

function normalizeHeader(value: unknown) {
  return normalizeCellText(value)
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function findJrwaTable(tables: string[][][]) {
  for (let tableIndex = 0; tableIndex < tables.length; tableIndex++) {
    const rows = tables[tableIndex];
    const headerIndex = rows.findIndex((row) => {
      const header = row.map(normalizeHeader).join(' | ');
      return header.includes('symbole klasyfikacyjne')
        && header.includes('haslo klasyfikacyjne')
        && header.includes('kategorii archiwalnej');
    });
    if (headerIndex >= 0 && rows.length - headerIndex > 10) {
      return { tableIndex, headerIndex, rows };
    }
  }
  return null;
}

function parseCategory(value: unknown) {
  const category = normalizeCellText(value).toUpperCase().replace(/\s+/g, '');
  if (!category) return null;
  if (category === 'A') {
    return { category, retentionYears: null, isPermanent: true, requiresReview: false };
  }
  if (category === 'B*' || category === 'BC') {
    return { category, retentionYears: null, isPermanent: false, requiresReview: true };
  }

  const match = category.match(/^B(E)?(\d{1,3})$/);
  if (!match) return null;
  const retentionYears = Number.parseInt(match[2], 10);
  if (!Number.isFinite(retentionYears) || retentionYears < 1 || retentionYears > 100) return null;

  return {
    category,
    retentionYears,
    isPermanent: false,
    requiresReview: Boolean(match[1]),
  };
}

function inferDocType(name: string, code: string) {
  const text = normalizeHeader(name);
  if (code.startsWith('1') || /akta osobowe|spraw kadrow|zatrudnien|wynagrodzen|listy plac/.test(text)) return 'personnel_files';
  if (code.startsWith('3') || /finans|ksiegow|ksiegi rachunk|budzet|faktur|rachunkow|podatk|bankow/.test(text)) return 'financial_documents';
  if (code.startsWith('4') || /projekt|program badawcz|grant|komercjalizac/.test(text)) return 'project_documents';
  if (/umow|kontrakt|porozumien/.test(text)) return 'contracts';
  if (/korespondenc|skarg|wniosk|petycj|zapytan|kontakt/.test(text)) return 'correspondence';
  if (/technic|urzadzen|informat|system|oprogram|budowlan|remont/.test(text)) return 'technical_docs';
  if (/prawn|legisl|regulac|zarzadzen|uchwal|postepowan|pelnomocnictw|upowaznien/.test(text)) return 'legal_documents';
  return 'other';
}

function getJrwaCode(cells: string[], symbolColumnCount: number) {
  return cells
    .slice(0, symbolColumnCount)
    .map(normalizeCellText)
    .filter(Boolean)
    .pop() || '';
}

export async function parseJrwaDocx(buffer: Buffer): Promise<JrwaParseResult> {
  const archive = await JSZip.loadAsync(buffer);
  const documentXmlFile = archive.file('word/document.xml');
  if (!documentXmlFile) {
    throw Object.assign(new Error('Plik nie zawiera prawidłowej struktury dokumentu DOCX'), { statusCode: 400 });
  }

  const documentXml = await documentXmlFile.async('string');
  const selected = findJrwaTable(extractTables(documentXml));
  if (!selected) {
    throw Object.assign(
      new Error('Nie znaleziono tabeli JRWA z kolumnami: symbole klasyfikacyjne, hasło klasyfikacyjne i kategoria archiwalna'),
      { statusCode: 400 }
    );
  }

  const header = selected.rows[selected.headerIndex];
  const normalizedHeader = header.map(normalizeHeader);
  const nameIndex = normalizedHeader.findIndex((value) => value.includes('haslo klasyfikacyjne'));
  const categoryIndex = normalizedHeader.findIndex((value) => value.includes('kategorii archiwalnej'));
  const descriptionIndex = normalizedHeader.findIndex((value) => value.includes('uszczegolowienie'));
  const symbolColumnCount = nameIndex > 0 ? nameIndex : Math.max(1, categoryIndex - 1);
  const rows: JrwaImportRow[] = [];
  const skipped: Array<{ rowNumber: number; reason: string }> = [];

  selected.rows.slice(selected.headerIndex + 1).forEach((cells, relativeIndex) => {
    const rowNumber = selected.headerIndex + relativeIndex + 2;
    const code = getJrwaCode(cells, symbolColumnCount);
    const name = normalizeCellText(cells[nameIndex]);
    const rawCategory = normalizeCellText(cells[categoryIndex]);

    if (!code && !name && !rawCategory) return;
    if (/^\d+$/.test(code) && /^\d+$/.test(name) && /^\d+$/.test(rawCategory)) return;
    if (!rawCategory) return;

    const parsedCategory = parseCategory(rawCategory);
    if (!code || !name) {
      skipped.push({ rowNumber, reason: 'Brak symbolu JRWA lub hasła klasyfikacyjnego' });
      return;
    }
    if (!parsedCategory) {
      skipped.push({ rowNumber, reason: `Nieobsługiwana kategoria archiwalna: ${rawCategory}` });
      return;
    }

    const description = descriptionIndex >= 0 ? normalizeCellText(cells[descriptionIndex]) : '';
    rows.push({
      rowNumber,
      jrwaCode: code,
      name,
      archivalCategory: parsedCategory.category,
      retentionYears: parsedCategory.retentionYears,
      isPermanent: parsedCategory.isPermanent,
      requiresReview: parsedCategory.requiresReview,
      docType: inferDocType(name, code),
      description: description || null,
    });
  });

  if (rows.length === 0) {
    throw Object.assign(new Error('Tabela JRWA nie zawiera klas końcowych możliwych do importu'), { statusCode: 400 });
  }

  return { rows, skipped, tableNumber: selected.tableIndex + 1 };
}
