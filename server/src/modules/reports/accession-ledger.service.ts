import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';

export type LedgerKind = 'acquisition' | 'disposal';

export function parseLedgerOptions(query: Record<string, unknown>, now = new Date()) {
  const year = query.year === undefined ? now.getFullYear() : Number(query.year);
  const page = query.page === undefined ? 1 : Number(query.page);
  const pageSize = query.pageSize === undefined ? 25 : Number(query.pageSize);
  const kind = query.kind === undefined || query.kind === '' ? null : query.kind;
  if (!Number.isInteger(year) || year < 2000 || year > now.getFullYear()
    || !Number.isInteger(page) || page < 1 || page > 10000
    || ![25, 50, 100].includes(pageSize)
    || (kind !== null && kind !== 'acquisition' && kind !== 'disposal')) {
    throw Object.assign(new Error('Nieprawidłowe filtry księgi nabytków i ubytków'), { statusCode: 400 });
  }
  return { year, page, pageSize, kind: kind as LedgerKind | null };
}

export type LedgerOptions = ReturnType<typeof parseLedgerOptions>;

interface LedgerRow {
  kind: LedgerKind;
  eventId: string;
  eventAt: Date;
  boxId: string;
  boxNumber: string;
  title: string;
  location: string | null;
  reference: string | null;
}

function ledgerSource(tenantId: string, year: number) {
  // Annual boundaries are local to the Polish archive, including the CET year change.
  const start = new Date(`${year}-01-01T00:00:00+01:00`);
  const end = new Date(`${year + 1}-01-01T00:00:00+01:00`);
  return Prisma.sql`
    WITH entries AS (
      SELECT 'acquisition'::text AS kind, c.id::text AS "eventId", c."eventAt" AS "eventAt",
        b.id::text AS "boxId", b."boxNumber" AS "boxNumber", b.title,
        l."fullPath" AS location, c.notes AS reference
      FROM custody_events c
      JOIN boxes b ON b.id = c."boxId"
      LEFT JOIN locations l ON l.id = c."toLocationId"
      WHERE b."tenantId" = ${tenantId}::uuid AND c."eventType" = 'receipt'
        AND c."eventAt" >= ${start} AND c."eventAt" < ${end}
        AND NOT EXISTS (
          SELECT 1 FROM audit_logs created
          WHERE created."tenantId" = b."tenantId" AND created.action = 'box.create'
            AND created."entityType" = 'box' AND created."entityId" = b.id
            AND created."newValues"->>'locationId' IS NOT NULL
        )
      UNION ALL
      SELECT 'acquisition'::text, a.id::text, a."createdAt",
        a."entityId"::text, a."newValues"->>'boxNumber', a."newValues"->>'title',
        a."newValues"->'location'->>'fullPath', a."newValues"->>'notes'
      FROM audit_logs a
      WHERE a."tenantId" = ${tenantId}::uuid AND a.action = 'box.create'
        AND a."entityType" = 'box' AND a."entityId" IS NOT NULL
        AND a."newValues"->>'locationId' IS NOT NULL
        AND a."createdAt" >= ${start} AND a."createdAt" < ${end}
      UNION ALL
      SELECT 'disposal'::text, a.id::text || ':' || box_data->>'id',
        COALESCE((a."newValues"->>'completedAt')::timestamptz, a."createdAt"),
        box_data->>'id', box_data->>'boxNumber', box_data->>'title',
        box_data->>'location', a."newValues"->>'protocolReference'
      FROM audit_logs a
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(a."newValues"->'boxes') = 'array'
          THEN a."newValues"->'boxes' ELSE '[]'::jsonb END
      ) box_data
      WHERE a."tenantId" = ${tenantId}::uuid AND a.action = 'disposal.batch_completed'
        AND a."entityType" = 'disposal_batch'
        AND COALESCE((a."newValues"->>'completedAt')::timestamptz, a."createdAt") >= ${start}
        AND COALESCE((a."newValues"->>'completedAt')::timestamptz, a."createdAt") < ${end}
    )`;
}

export async function getAccessionLedger(tenantId: string, options: LedgerOptions) {
  const source = ledgerSource(tenantId, options.year);
  const kindFilter = options.kind ? Prisma.sql`WHERE kind = ${options.kind}` : Prisma.empty;
  const [counts, rows] = await Promise.all([
    prisma.$queryRaw<Array<{ acquisitions: bigint; disposals: bigint }>>(
      Prisma.sql`${source} SELECT
        COUNT(*) FILTER (WHERE kind = 'acquisition') AS acquisitions,
        COUNT(*) FILTER (WHERE kind = 'disposal') AS disposals FROM entries`,
    ),
    prisma.$queryRaw<LedgerRow[]>(Prisma.sql`${source}
      SELECT kind, "eventId", "eventAt", "boxId", "boxNumber", title, location, reference
      FROM entries ${kindFilter}
      ORDER BY "eventAt" DESC, "eventId" DESC
      LIMIT ${options.pageSize} OFFSET ${(options.page - 1) * options.pageSize}`),
  ]);
  const acquisitions = Number(counts[0]?.acquisitions ?? 0);
  const disposals = Number(counts[0]?.disposals ?? 0);
  return {
    year: options.year, page: options.page, pageSize: options.pageSize,
    kind: options.kind, acquisitions, disposals,
    total: options.kind === 'acquisition' ? acquisitions : options.kind === 'disposal' ? disposals : acquisitions + disposals,
    data: rows,
  };
}

export async function getAccessionLedgerExport(tenantId: string, options: LedgerOptions) {
  const kindFilter = options.kind ? Prisma.sql`WHERE kind = ${options.kind}` : Prisma.empty;
  const rows = await prisma.$queryRaw<LedgerRow[]>(Prisma.sql`${ledgerSource(tenantId, options.year)}
    SELECT kind, "eventId", "eventAt", "boxId", "boxNumber", title, location, reference
    FROM entries ${kindFilter}
    ORDER BY "eventAt" DESC, "eventId" DESC LIMIT 20001`);
  if (rows.length > 20000) {
    throw Object.assign(new Error('Eksport przekracza 20 000 wpisów. Skontaktuj się z administratorem.'), { statusCode: 413 });
  }
  return rows;
}

function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value);
  // Treat user-entered identifiers and titles as text in spreadsheet applications.
  const safe = /^[\s]*[=+@-]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function buildAccessionLedgerCsv(rows: LedgerRow[]): Buffer {
  const header = ['Data', 'Rodzaj', 'Numer kartonu', 'Tytuł kartonu', 'Lokalizacja', 'Uwagi / numer protokołu', 'ID zdarzenia'];
  const lines = rows.map((row) => [
    row.eventAt.toISOString(), row.kind === 'acquisition' ? 'Nabytek' : 'Ubytek',
    row.boxNumber, row.title, row.location, row.reference, row.eventId,
  ].map(csvCell).join(';'));
  return Buffer.from(`\uFEFF${[header.map(csvCell).join(';'), ...lines].join('\r\n')}\r\n`, 'utf8');
}
