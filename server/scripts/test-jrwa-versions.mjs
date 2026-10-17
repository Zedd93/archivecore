import assert from 'node:assert/strict';
import test from 'node:test';

const { RetentionService } = await import('../src/modules/retention/retention.service.ts');
const { parseJrwaValidFrom, previousJrwaDay } = await import('../src/modules/retention/jrwa-version.ts');
const { prisma } = await import('../src/config/database.ts');

const actor = { userId: 'admin', tenantId: null, roles: ['SUPER_ADMIN'], permissions: ['system.config'] };
const tenantId = '3bdf2103-350b-4c9b-a2dd-44e7b3845594';
const row = {
  jrwaCode: '1234', name: 'Akta', docType: 'other', retentionYears: 10,
  archivalCategory: 'B10', isPermanent: false, description: null,
};

test('JRWA validity dates are strict calendar dates', () => {
  assert.equal(parseJrwaValidFrom('2026-10-17').toISOString(), '2026-10-17T00:00:00.000Z');
  assert.equal(previousJrwaDay(parseJrwaValidFrom('2027-01-01')).toISOString().slice(0, 10), '2026-12-31');
  for (const invalid of ['2026-02-30', '2026-13-01', '2026-10-17T00:00:00Z', '']) {
    assert.throws(() => parseJrwaValidFrom(invalid), { statusCode: 400 });
  }
});

test('new version copies rows and closes prior validity without editing old policies', async () => {
  const service = new RetentionService();
  service.previewJrwa = async () => ({ rows: [row], skipped: [], tenant: { id: tenantId }, fileName: 'jrwa.docx' });
  const originalTransaction = prisma.$transaction;
  const calls = [];
  const db = {
    jrwaVersion: {
      findFirst: async () => ({ id: 'old-version', validFrom: new Date('2025-01-01T00:00:00Z') }),
      create: async ({ data }) => { calls.push(['createVersion', data]); return { id: 'new-version', ...data }; },
      update: async ({ where, data }) => { calls.push(['closeVersion', where, data]); },
    },
    retentionPolicy: {
      createMany: async ({ data }) => { calls.push(['createPolicies', data]); return { count: data.length }; },
      update: async () => { throw new Error('Old policy must never be updated'); },
    },
  };
  prisma.$transaction = async (fn) => fn(db);
  try {
    const result = await service.importJrwa(Buffer.alloc(0), 'jrwa.docx', tenantId, actor, '2026 update', '2026-01-01');
    assert.equal(result.created, 1);
    assert.equal(result.updated, 0);
    assert.equal(result.version.id, 'new-version');
    assert.equal(calls[0][1].tenantId, tenantId);
    assert.equal(calls[1][2].validTo.toISOString().slice(0, 10), '2025-12-31');
    assert.equal(calls[2][1][0].jrwaVersionId, 'new-version');
  } finally {
    prisma.$transaction = originalTransaction;
  }
});

test('non-chronological version and repeated symbols are rejected without writes', async () => {
  const service = new RetentionService();
  service.previewJrwa = async () => ({ rows: [row], skipped: [], tenant: { id: tenantId } });
  const originalTransaction = prisma.$transaction;
  const db = {
    jrwaVersion: {
      findFirst: async () => ({ id: 'latest', validFrom: new Date('2026-01-01T00:00:00Z') }),
      create: async () => { throw new Error('Must not create'); },
    },
  };
  prisma.$transaction = async (fn) => fn(db);
  try {
    await assert.rejects(service.importJrwa(Buffer.alloc(0), 'jrwa.docx', tenantId, actor, 'older', '2025-01-01'), { statusCode: 409 });
    await assert.rejects(service.importJrwa(Buffer.alloc(0), 'jrwa.docx', tenantId, actor, 'invalid', '2026-02-30'), { statusCode: 400 });
    service.previewJrwa = async () => ({ rows: [row, { ...row }], skipped: [], tenant: { id: tenantId } });
    await assert.rejects(service.importJrwa(Buffer.alloc(0), 'jrwa.docx', tenantId, actor, 'duplicates', '2027-01-01'), { statusCode: 400 });
  } finally {
    prisma.$transaction = originalTransaction;
  }
});

test('imported JRWA policies cannot be changed or removed', async () => {
  const service = new RetentionService();
  service.getPolicy = async () => ({ id: 'old-policy', tenantId, jrwaCode: '1234', _count: { boxes: 0 } });
  await assert.rejects(service.updatePolicy('old-policy', tenantId, actor, { name: 'Changed' }), { statusCode: 409 });
  await assert.rejects(service.deletePolicy('old-policy', tenantId, actor), { statusCode: 409 });
});

test('JRWA version listing is restricted to the tenant context', async () => {
  const service = new RetentionService();
  const tenantActor = { userId: 'user', tenantId, roles: [], permissions: [] };
  const originalFindMany = prisma.jrwaVersion.findMany;
  prisma.jrwaVersion.findMany = async ({ where }) => {
    assert.deepEqual(where, { tenantId });
    return [{ id: 'own-version' }];
  };
  try {
    assert.deepEqual(await service.listJrwaVersions(tenantId, tenantActor), [{ id: 'own-version' }]);
    await assert.rejects(service.listJrwaVersions(tenantId, tenantActor, 'other-tenant'), { statusCode: 403 });
  } finally {
    prisma.jrwaVersion.findMany = originalFindMany;
  }
});
