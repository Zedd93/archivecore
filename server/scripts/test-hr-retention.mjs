import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { calculateHRRetention } = require('../dist/modules/hr/hr-retention.js');
const { HRService } = require('../dist/modules/hr/hr.service.js');
const { ExportService } = require('../dist/modules/import-export/export.service.js');
const { prisma } = require('../dist/config/database.js');
const { createHRFolderSchema } = require('../../shared/src/validators/hr.schema.ts');

const base = {
  employmentStart: '2019-01-01',
  employmentEnd: '2024-04-12',
  riaStatus: 'unknown',
  riaSubmittedAt: null,
};

test('employment from 2019 uses ten years from the end of the calendar year', () => {
  const result = calculateHRRetention(base);
  assert.equal(result.retentionBasis, 'post_2018');
  assert.equal(result.retentionPeriod, 'ten_years');
  assert.equal(result.retentionBaseDate.toISOString().slice(0, 10), '2024-12-31');
  assert.equal(result.retentionEndDate.toISOString().slice(0, 10), '2034-12-31');
});

test('employment before 1999 uses fifty years from termination', () => {
  const result = calculateHRRetention({ ...base, employmentStart: '1998-12-31' });
  assert.equal(result.retentionBasis, 'pre_1999');
  assert.equal(result.retentionEndDate.toISOString().slice(0, 10), '2074-04-12');
});

test('transitional employment is not assigned a deadline until RIA status is confirmed', () => {
  const result = calculateHRRetention({ ...base, employmentStart: '1999-01-01' });
  assert.equal(result.retentionBasis, 'needs_review');
  assert.equal(result.retentionEndDate, null);
});

test('invalid or premature RIA data cannot produce a ten-year deadline', () => {
  const result = calculateHRRetention({ ...base, employmentStart: '2010-01-01', riaStatus: 'submitted', riaSubmittedAt: '2018-01-01' });
  assert.equal(result.retentionBasis, 'needs_review');
  assert.equal(result.retentionEndDate, null);
});

test('confirmed absence of RIA keeps fifty-year period', () => {
  const result = calculateHRRetention({ ...base, employmentStart: '2018-12-31', riaStatus: 'not_submitted' });
  assert.equal(result.retentionBasis, 'transitional_50');
  assert.equal(result.retentionEndDate.toISOString().slice(0, 10), '2074-04-12');
});

test('leap-day anniversary for fifty-year term requires manual review', () => {
  const result = calculateHRRetention({ ...base, employmentStart: '1998-12-31', employmentEnd: '2020-02-29' });
  assert.equal(result.retentionBasis, 'needs_review');
  assert.equal(result.retentionEndDate, null);
});

test('submitted RIA uses its calendar year, not employment termination year', () => {
  const result = calculateHRRetention({ ...base, employmentStart: '2018-12-31', riaStatus: 'submitted', riaSubmittedAt: '2025-06-02' });
  assert.equal(result.retentionBasis, 'transitional_ria');
  assert.equal(result.retentionEndDate.toISOString().slice(0, 10), '2035-12-31');
});

test('missing termination never produces a disposal date', () => {
  const result = calculateHRRetention({ ...base, employmentEnd: null });
  assert.equal(result.retentionEndDate, null);
});

test('missing employment start requires review even with a termination date', () => {
  const result = calculateHRRetention({ ...base, employmentStart: null });
  assert.equal(result.retentionBasis, 'needs_review');
  assert.equal(result.retentionEndDate, null);
});

test('special-rule flag suppresses an otherwise calculated deadline', () => {
  const result = calculateHRRetention({ ...base, retentionReviewRequired: true });
  assert.equal(result.retentionBasis, 'needs_review');
  assert.equal(result.retentionEndDate, null);
});

test('create validation rejects unsupported manual periods and implausible dates', () => {
  const valid = {
    employeeFirstName: 'Anna', employeeLastName: 'Nowak', employeePesel: '44051401359',
    employmentStart: '2010-01-01', employmentEnd: '2020-01-01', riaStatus: 'submitted', riaSubmittedAt: '2022-05-01',
  };
  assert.equal(createHRFolderSchema.safeParse(valid).success, true);
  assert.equal(createHRFolderSchema.safeParse({ ...valid, riaSubmittedAt: undefined }).success, false);
  assert.equal(createHRFolderSchema.safeParse({ ...valid, riaSubmittedAt: '2018-01-01' }).success, false);
  assert.equal(createHRFolderSchema.safeParse({ ...valid, riaSubmittedAt: '2019-01-01' }).success, false);
  assert.equal(createHRFolderSchema.safeParse({ ...valid, employmentEnd: '2009-12-31' }).success, false);
  assert.equal(createHRFolderSchema.safeParse({ ...valid, employmentStart: '2020-02-31' }).success, false);
  assert.equal('retentionPeriod' in createHRFolderSchema.parse({ ...valid, retentionPeriod: 'ten_years' }), false);
});

test('updating a legacy record recalculates only after employment and RIA data are supplied', async () => {
  const service = new HRService();
  const originalFindFirst = prisma.hRFolder.findFirst;
  const originalUpdate = prisma.hRFolder.update;
  const legacy = {
    id: '19b77167-607c-4cf6-a8b1-c724be113bc9', tenantId: '895af3d7-508b-48a2-a3ea-75fdce44dcb1',
    employmentStart: new Date('2010-01-01'), employmentEnd: new Date('2020-01-01'),
    riaStatus: 'unknown', riaSubmittedAt: null, retentionReviewRequired: false,
    retentionBasis: 'needs_review', retentionEndDate: new Date('2030-01-01'),
  };
  prisma.hRFolder.findFirst = async () => legacy;
  try {
    prisma.hRFolder.update = async ({ data }) => {
      assert.equal(data.retentionBasis, undefined);
      assert.equal(data.retentionEndDate, undefined);
      return { ...legacy, ...data };
    };
    await service.update(legacy.id, legacy.tenantId, { employeeFirstName: 'Anna' });

    prisma.hRFolder.update = async ({ data }) => {
      assert.equal(data.retentionBasis, 'transitional_ria');
      assert.equal(data.retentionEndDate.toISOString().slice(0, 10), '2035-12-31');
      return { ...legacy, ...data };
    };
    await service.update(legacy.id, legacy.tenantId, { riaStatus: 'submitted', riaSubmittedAt: '2025-06-02' });
  } finally {
    prisma.hRFolder.findFirst = originalFindFirst;
    prisma.hRFolder.update = originalUpdate;
  }
});

test('upcoming HR retention excludes legacy unverified dates', async () => {
  const service = new HRService();
  const originalFindMany = prisma.hRFolder.findMany;
  prisma.hRFolder.findMany = async ({ where }) => {
    assert.deepEqual(where.retentionBasis, { not: 'needs_review' });
    assert.equal(where.litigationHold, false);
    return [];
  };
  try {
    await service.getRetentionExpiring('895af3d7-508b-48a2-a3ea-75fdce44dcb1');
  } finally {
    prisma.hRFolder.findMany = originalFindMany;
  }
});

test('HR export hides unverified legacy deadlines and respects the review filter', async () => {
  const service = new ExportService();
  const originalFindMany = prisma.hRFolder.findMany;
  prisma.hRFolder.findMany = async ({ where }) => {
    assert.equal(where.retentionBasis, 'needs_review');
    return [{
      employeeFirstName: 'Anna', employeeLastName: 'Nowak', employmentStatus: 'terminated',
      retentionPeriod: 'ten_years', retentionBasis: 'needs_review',
      retentionEndDate: new Date('2030-01-01'), riaSubmittedAt: null, litigationHold: false,
    }];
  };
  try {
    const result = await service.exportHR('895af3d7-508b-48a2-a3ea-75fdce44dcb1', { retentionBasis: 'needs_review' }, 'csv');
    const csv = result.buffer.toString('utf8');
    assert.match(csv, /Wymaga weryfikacji/);
    assert.doesNotMatch(csv, /2030-01-01/);
  } finally {
    prisma.hRFolder.findMany = originalFindMany;
  }
});
