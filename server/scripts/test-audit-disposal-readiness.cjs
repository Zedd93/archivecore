const assert = require('node:assert/strict');
const test = require('node:test');
const { auditDisposalReadiness } = require('./audit-disposal-readiness.cjs');

function folder(id, fields = {}) {
  return {
    id,
    dateTo: new Date('2020-12-31'),
    tenant: { shortCode: 'DOX' },
    box: { id: 'box-1', boxNumber: 'K-1' },
    retentionPolicy: { retentionTrigger: 'end_date', retentionYears: 10, isPermanent: false, archivalCategory: 'B10' },
    transferListItem: {
      ordinalNumber: 7, categoryCode: 'B10', dateFrom: new Date('2019-01-01'), dateTo: new Date('2020-12-31'),
      transferList: { listNumber: 'SZO-2026-0001', status: 'confirmed' },
    },
    ...fields,
  };
}

test('read-only audit paginates and reports only non-sensitive identifiers', async () => {
  const rows = [
    folder('1', { retentionPolicy: null, transferListItem: null }),
    folder('2', { dateTo: null, transferListItem: {
      ordinalNumber: 8, categoryCode: 'B10', dateFrom: null, dateTo: null,
      transferList: { listNumber: 'SZO-2026-0001', status: 'confirmed' },
    } }),
    folder('3'),
    folder('4', { retentionPolicy: { retentionTrigger: 'event_date', retentionYears: null, isPermanent: false, archivalCategory: 'B10' }, transferListItem: { categoryCode: 'X', dateTo: null } }),
    folder('5', { retentionPolicy: { retentionTrigger: 'end_date', retentionYears: null, isPermanent: true, archivalCategory: 'A' }, transferListItem: { categoryCode: 'A', dateTo: null } }),
  ];
  const cursors = [];
  const db = { folder: { findMany: async (query) => {
    assert.equal(query.take, 2);
    assert.deepEqual(query.where.status, { not: 'disposed' });
    assert.deepEqual(query.where.box.is.deletedAt, null);
    assert.equal(query.select.title, undefined);
    assert.equal(query.select.description, undefined);
    assert.deepEqual(query.select.tenant, { select: { shortCode: true } });
    cursors.push(query.cursor?.id ?? null);
    const start = query.cursor ? rows.findIndex((row) => row.id === query.cursor.id) + 1 : 0;
    return rows.slice(start, start + query.take);
  } } };
  const report = await auditDisposalReadiness(db, { pageSize: 2 });
  assert.deepEqual(cursors, [null, '2', '4']);
  assert.equal(report.checked, 5);
  assert.equal(report.protected, 1);
  assert.deepEqual(report.issues, {
    orphan: 1, noBasis: 1, missingYears: 1, unsupportedTrigger: 1, missingEndDate: 1, unknownCategory: 1,
  });
  assert.deepEqual(report.byTenant.DOX, report.issues);
  assert.deepEqual(report.missingEndDateByStatus, { confirmed: 1 });
  assert.deepEqual(report.missingEndDateBySource, { explicitNoDates: 0, unclassified: 1 });
  assert.ok(report.examples.every((example) => !('title' in example) && !('description' in example)));
});

test('empty archive is clean and example count is bounded per issue', async () => {
  const empty = await auditDisposalReadiness({ folder: { findMany: async () => [] } });
  assert.equal(empty.checked, 0);
  assert.ok(Object.values(empty.issues).every((count) => count === 0));

  const rows = [folder('1', { retentionPolicy: null, transferListItem: null }), folder('2', { retentionPolicy: null, transferListItem: null })];
  const report = await auditDisposalReadiness({ folder: { findMany: async () => rows } }, { exampleLimit: 1 });
  assert.equal(report.issues.orphan, 2);
  assert.equal(report.issues.noBasis, 2);
  assert.equal(report.examples.length, 2);
});

test('tenant detail view exposes list status and both dates without titles or writes', async () => {
  const row = folder('folder-34', {
    dateFrom: null, dateTo: null,
    tenant: { shortCode: 'SMPOLI' },
    transferListItem: {
      ordinalNumber: 34, categoryCode: 'B10', dateFrom: null, dateTo: null, dateRangeUnknown: true,
      transferList: { listNumber: 'SZO-2026-0034', status: 'archived' },
    },
  });
  const db = { folder: { findMany: async (query) => {
    assert.equal(query.where.tenant.is.shortCode, 'SMPOLI');
    assert.equal(query.select.title, undefined);
    assert.equal(query.select.transferListItem.select.transferList.select.status, true);
    return [row];
  } } };
  const report = await auditDisposalReadiness(db, { tenantCode: 'SMPOLI', details: true });
  assert.equal(report.issues.missingEndDate, 1);
  assert.deepEqual(report.missingEndDateByStatus, { archived: 1 });
  assert.deepEqual(report.missingEndDateBySource, { explicitNoDates: 1, unclassified: 0 });
  assert.deepEqual(report.details, [{
    issue: 'missingEndDate', tenant: 'SMPOLI', boxNumber: 'K-1', folderId: 'folder-34',
    listNumber: 'SZO-2026-0034', listStatus: 'archived', position: 34, category: 'B10',
    policyTrigger: 'end_date', policyYears: 10,
    folderDateFrom: null, folderDateTo: null,
    itemDateFrom: null, itemDateTo: null, sourceNoDates: true,
  }]);
});
