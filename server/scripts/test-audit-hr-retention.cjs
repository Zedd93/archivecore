const assert = require('node:assert/strict');
const test = require('node:test');
const { auditHRRetention } = require('./audit-hr-retention.cjs');

function row(id, fields) {
  return {
    id, tenant: { shortCode: 'DOX' }, employmentStart: new Date('2019-01-01'),
    employmentEnd: new Date('2024-04-12'), riaStatus: 'unknown', riaSubmittedAt: null,
    retentionReviewRequired: false, retentionBasis: 'post_2018', retentionPeriod: 'ten_years',
    retentionBaseDate: new Date('2024-12-31'), retentionEndDate: new Date('2034-12-31'),
    ...fields,
  };
}

test('audit is paginated, read-only, and does not retrieve personnel identifiers', async () => {
  const rows = [
    row('1', {}),
    row('2', {
      employmentStart: new Date('1998-12-31'), employmentEnd: new Date('2000-01-01'),
      retentionBasis: 'needs_review', retentionPeriod: 'ten_years',
      retentionBaseDate: null, retentionEndDate: new Date('2050-01-01'),
    }),
    row('3', {
      employmentStart: new Date('2010-01-01'), employmentEnd: new Date('2020-01-01'),
      riaStatus: 'submitted', riaSubmittedAt: new Date('2030-01-01'),
      retentionBasis: 'transitional_ria', retentionPeriod: 'ten_years',
      retentionBaseDate: new Date('2030-01-01'), retentionEndDate: new Date('2040-12-31'),
    }),
    row('4', {
      employmentStart: new Date('2010-01-01'), employmentEnd: new Date('2020-01-01'),
      retentionBasis: 'needs_review', retentionPeriod: 'ten_years',
      retentionBaseDate: null, retentionEndDate: new Date('2030-01-01'),
    }),
  ];
  const cursors = [];
  const db = {
    hRFolder: {
      findMany: async (query) => {
        assert.equal(query.take, 2);
        assert.equal(query.select.employeePesel, undefined);
        assert.equal(query.select.employeeFirstName, undefined);
        assert.equal(query.select.employeeLastName, undefined);
        assert.deepEqual(query.select.tenant, { select: { shortCode: true } });
        cursors.push(query.cursor?.id ?? null);
        const start = query.cursor ? rows.findIndex((item) => item.id === query.cursor.id) + 1 : 0;
        return rows.slice(start, start + query.take);
      },
    },
  };
  const report = await auditHRRetention(db, { now: new Date('2026-10-17'), pageSize: 2 });
  assert.deepEqual(cursors, [null, '2', '4']);
  assert.equal(report.total, 4);
  assert.equal(report.needsReview, 2);
  assert.equal(report.mismatches, 2);
  assert.equal(report.futureRia, 1);
  assert.equal(report.hiddenLegacyDates, 2);
  assert.deepEqual(report.examples.map((item) => item.id), ['2', '3']);
});

test('empty archive has no issues', async () => {
  const db = { hRFolder: { findMany: async () => [] } };
  const report = await auditHRRetention(db);
  assert.equal(report.total, 0);
  assert.equal(report.mismatches, 0);
});
