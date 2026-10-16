import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { ACTIVE_SLA_STATUSES } from './order-sla';

const REPORT_KINDS = ['completed', 'breached', 'activeOverdue'] as const;
type SlaReportKind = typeof REPORT_KINDS[number];

function invalidReportFilter(): never {
  throw Object.assign(new Error('Nieprawidłowy filtr raportu SLA'), { statusCode: 400 });
}

export async function slaReportWhere(tenantId: string, filters: Record<string, unknown>): Promise<Prisma.OrderWhereInput | null> {
  if (filters.slaReport === undefined || filters.slaReport === '') return null;
  const kind = filters.slaReport;
  const days = Number(filters.slaDays);
  const asOfValue = filters.slaAsOf;
  if (typeof kind !== 'string' || !REPORT_KINDS.includes(kind as SlaReportKind)
    || ![30, 90, 180, 365].includes(days)
    || typeof asOfValue !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(asOfValue)) invalidReportFilter();

  const asOf = new Date(asOfValue as string);
  if (Number.isNaN(asOf.getTime()) || asOf.toISOString() !== asOfValue
    || asOf.getTime() > Date.now() + 5 * 60_000) invalidReportFilter();
  const since = new Date(asOf.getTime() - days * 24 * 60 * 60_000);

  if (kind === 'activeOverdue') {
    return { status: { in: [...ACTIVE_SLA_STATUSES] }, slaDeadline: { lt: asOf } };
  }

  const completed: Prisma.OrderWhereInput = {
    status: 'completed',
    completedAt: { gte: since, lte: asOf },
    slaDeadline: { not: null },
  };
  if (kind === 'completed') return completed;

  // Prisma cannot compare two columns in a where clause; keep this predicate identical to the report SQL.
  const overdue = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id" FROM "orders"
    WHERE "tenantId" = ${tenantId}::uuid
      AND "status" = 'completed'
      AND "completedAt" >= ${since}
      AND "completedAt" <= ${asOf}
      AND "completedAt" > "slaDeadline"
  `);
  return { ...completed, id: { in: overdue.map((order) => order.id) } };
}
