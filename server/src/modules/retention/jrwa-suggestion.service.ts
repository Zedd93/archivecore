import { prisma } from '../../config/database';

type JrwaMatch = 'exactCode' | 'codePrefix' | 'name';

function matchType(policy: { jrwaCode: string | null; name: string }, query: string): JrwaMatch {
  const code = policy.jrwaCode?.toLocaleLowerCase('pl-PL') ?? '';
  const normalized = query.toLocaleLowerCase('pl-PL');
  if (code === normalized) return 'exactCode';
  if (/^\d{2,}$/.test(query) && code.startsWith(normalized)) return 'codePrefix';
  return 'name';
}

function todayInWarsaw(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)));
}

export class JrwaSuggestionService {
  private async currentVersionId(tenantId: string) {
    const today = todayInWarsaw();
    const version = await prisma.jrwaVersion.findFirst({
      where: {
        tenantId,
        validFrom: { lte: today },
        OR: [{ validTo: null }, { validTo: { gte: today } }],
      },
      orderBy: { validFrom: 'desc' },
      select: { id: true },
    });
    return version?.id ?? null;
  }

  async suggest(tenantId: string, rawQuery: string) {
    const query = rawQuery.trim();
    if ((query.length < 2 && !/^\d$/.test(query)) || query.length > 100) return [];
    const jrwaVersionId = await this.currentVersionId(tenantId);
    const policies = await prisma.retentionPolicy.findMany({
      where: {
        tenantId,
        jrwaVersionId,
        isActive: true,
        jrwaCode: { not: null },
        OR: /^\d$/.test(query)
          ? [{ jrwaCode: { equals: query, mode: 'insensitive' } }]
          : [
            { jrwaCode: { equals: query, mode: 'insensitive' } },
            ...(/^\d{2,}$/.test(query) ? [{ jrwaCode: { startsWith: query, mode: 'insensitive' as const } }] : []),
            { name: { contains: query, mode: 'insensitive' } },
          ],
      },
      select: {
        id: true,
        jrwaCode: true,
        name: true,
        archivalCategory: true,
        retentionYears: true,
        isPermanent: true,
        jrwaVersion: { select: { label: true, validFrom: true, validTo: true } },
      },
      orderBy: [{ jrwaCode: 'asc' }, { name: 'asc' }],
      take: 100,
    });
    const priority: Record<JrwaMatch, number> = { exactCode: 0, codePrefix: 1, name: 2 };
    return policies
      .map((policy) => ({ ...policy, matchType: matchType(policy, query) }))
      .sort((a, b) => priority[a.matchType] - priority[b.matchType]
        || (a.jrwaCode ?? '').localeCompare(b.jrwaCode ?? '', 'pl', { numeric: true })
        || a.name.localeCompare(b.name, 'pl'))
      .slice(0, 30);
  }

  async validateSelection(tenantId: string, policyId: string | null | undefined, categoryCode: string, existingPolicyId?: string | null) {
    if (!policyId) return null;
    const policy = await prisma.retentionPolicy.findFirst({
      where: { id: policyId, tenantId, jrwaCode: { not: null } },
      select: { id: true, archivalCategory: true, jrwaVersionId: true, isActive: true },
    });
    if (!policy) {
      throw Object.assign(new Error('Wybrana pozycja JRWA nie należy do tego tenanta'), { statusCode: 400 });
    }
    if (!policy.archivalCategory || policy.archivalCategory.toUpperCase() !== categoryCode.trim().toUpperCase()) {
      throw Object.assign(new Error('Kategoria akt nie zgadza się z wybraną pozycją JRWA'), { statusCode: 400 });
    }
    if (policy.id !== existingPolicyId) {
      const currentVersionId = await this.currentVersionId(tenantId);
      if (!policy.isActive || policy.jrwaVersionId !== currentVersionId) {
        throw Object.assign(new Error('Wybrana pozycja JRWA nie jest już bieżąca. Wyszukaj ją ponownie.'), { statusCode: 409 });
      }
    }
    return policy.id;
  }
}

export const jrwaSuggestionService = new JrwaSuggestionService();
