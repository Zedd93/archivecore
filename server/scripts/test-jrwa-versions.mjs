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
      findMany: async ({ where }) => {
        assert.equal(where.tenantId, tenantId);
        assert.deepEqual(where.jrwaCode.in, ['1234']);
        return [{ jrwaCode: '1234', seriesLegalHoldReason: 'Postepowanie sadowe', seriesLegalHoldAt: new Date('2025-03-01T00:00:00Z') }];
      },
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
    assert.equal(calls[2][1][0].seriesLegalHold, true);
    assert.equal(calls[2][1][0].seriesLegalHoldReason, 'Postepowanie sadowe');
  } finally {
    prisma.$transaction = originalTransaction;
  }
});

test('placing a JRWA series hold updates every version, withdraws pending boxes and audits the change', async () => {
  const service = new RetentionService();
  const originalTransaction = prisma.$transaction;
  const calls = [];
  prisma.$transaction = async (fn) => fn({
    retentionPolicy: {
      findUnique: async () => ({ tenantId, jrwaCode: '1234' }),
      findFirst: async () => null,
      updateMany: async ({ where, data }) => { calls.push(['policies', where, data]); return { count: 2 }; },
    },
    box: {
      updateMany: async ({ where, data }) => { calls.push(['boxes', where, data]); return { count: 3 }; },
    },
    auditLog: { create: async ({ data }) => { calls.push(['audit', data]); return data; } },
  });
  try {
    const result = await service.setJrwaSeriesLegalHold('policy-id', tenantId, actor, true, 'Postepowanie sadowe');
    assert.equal(result.withdrawnBoxes, 3);
    assert.deepEqual(calls[0][1], { tenantId, jrwaCode: '1234' });
    assert.equal(calls[0][2].seriesLegalHold, true);
    assert.equal(calls[1][1].tenantId, tenantId);
    assert.deepEqual(calls[1][1].status.in, ['pending_disposal', 'approved_disposal']);
    assert.equal(calls[1][1].OR.length, 3);
    assert.equal(calls[1][2].status, 'active');
    assert.equal(calls[1][2].disposalReviewedAt, null);
    assert.equal(calls[1][2].apDecision, null);
    assert.equal(calls[2][1].action, 'legal_hold.placed');
    assert.equal(calls[2][1].newValues.jrwaCode, '1234');
  } finally {
    prisma.$transaction = originalTransaction;
  }
});

test('releasing a JRWA series hold does not restart disposal', async () => {
  const service = new RetentionService();
  const originalTransaction = prisma.$transaction;
  let boxUpdate = false;
  prisma.$transaction = async (fn) => fn({
    retentionPolicy: {
      findUnique: async () => ({ tenantId, jrwaCode: '1234' }),
      findFirst: async () => ({ seriesLegalHoldReason: 'Postepowanie sadowe' }),
      updateMany: async ({ data }) => { assert.equal(data.seriesLegalHold, false); return { count: 2 }; },
    },
    box: { updateMany: async () => { boxUpdate = true; throw new Error('Must not restart disposal'); } },
    auditLog: { create: async () => ({}) },
  });
  try {
    const result = await service.setJrwaSeriesLegalHold('policy-id', tenantId, actor, false, 'Sprawa zakonczona');
    assert.equal(result.withdrawnBoxes, 0);
    assert.equal(boxUpdate, false);
  } finally {
    prisma.$transaction = originalTransaction;
  }
});

test('JRWA series hold cannot cross tenant boundaries', async () => {
  const service = new RetentionService();
  const originalTransaction = prisma.$transaction;
  prisma.$transaction = async (fn) => fn({
    retentionPolicy: {
      findUnique: async () => ({ tenantId, jrwaCode: '1234' }),
      findFirst: async () => { throw new Error('Must not read another tenant series'); },
    },
  });
  try {
    const tenantActor = { userId: 'user', tenantId: 'other', roles: [], permissions: ['retention.manage'] };
    await assert.rejects(service.setJrwaSeriesLegalHold('policy-id', 'other', tenantActor, true, 'Postepowanie sadowe'), { statusCode: 403 });
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
