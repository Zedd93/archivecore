import { prisma } from '../../config/database';

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
    return prisma.retentionPolicy.findMany({
      where: {
        tenantId,
        jrwaVersionId,
        isActive: true,
        jrwaCode: { not: null },
        OR: /^\d$/.test(query)
          ? [{ jrwaCode: { equals: query, mode: 'insensitive' } }]
          : [
            { jrwaCode: { equals: query, mode: 'insensitive' } },
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
      take: 30,
    });
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
