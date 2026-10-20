const assert = require('node:assert/strict');
const test = require('node:test');
const { parseArgs, reconcileMissingDates } = require('./reconcile-transfer-list-missing-dates.cjs');

const parsed = {
  items: [
    { folderSignature: 'A/1', folderTitle: 'Teczka 1', categoryCode: 'B50', dateFrom: null, dateTo: null, dateRangeUnknown: true },
    { folderSignature: 'A/2', folderTitle: 'Teczka 2', categoryCode: 'B5', dateFrom: '2020-01-01', dateTo: '2020-12-31', dateRangeUnknown: false },
  ],
  rowNumbers: [5, 6],
  errors: [],
};

function setup(overrides = {}) {
  const writes = [];
  const row = {
    id: 'item-1', ordinalNumber: 1, folderSignature: 'A/1', folderTitle: 'Teczka 1', categoryCode: 'B50',
    dateFrom: null, dateTo: null, dateRangeUnknown: false,
    folder: { id: 'folder-1', tenantId: 'tenant-1', folderNumber: 'A/1', title: 'Teczka 1', dateFrom: null, dateTo: null, legalHold: false },
  };
  const second = {
    id: 'item-2', ordinalNumber: 2, folderSignature: 'A/2', folderTitle: 'Teczka 2', categoryCode: 'B5',
    dateFrom: new Date('2020-01-01'), dateTo: new Date('2020-12-31'), dateRangeUnknown: false,
    folder: { id: 'folder-2', tenantId: 'tenant-1', folderNumber: 'A/2', title: 'Teczka 2', dateFrom: new Date('2020-01-01'), dateTo: new Date('2020-12-31'), legalHold: false },
  };
  Object.assign(row, overrides.row);
  const db = {
    transferList: { findMany: async (query) => {
      assert.equal(query.where.listNumber, 'SZO-2026-0001');
      assert.equal(query.where.tenant.is.shortCode, 'SMPOLI');
      return overrides.lists ?? [{ id: 'list-1', tenantId: 'tenant-1', status: 'draft', legalHold: false, ...overrides.list }];
    } },
    transferListItem: {
      findMany: async () => overrides.records ?? [row, second],
      updateMany: async (query) => { writes.push(query); return { count: overrides.updateCount ?? 1 }; },
    },
    user: { findFirst: async () => ({ id: 'actor-1', userRoles: [{ role: { code: overrides.role ?? 'SA' } }] }) },
    auditLog: { create: async (query) => { writes.push(query); } },
  };
  return { db, writes };
}

const input = { tenant: 'SMPOLI', list: 'SZO-2026-0001', parsed, sourceHash: 'hash', expect: 1 };

test('requires explicit tenant, list, file and expected count for a preview', () => {
  assert.deepEqual(parseArgs(['--tenant', 'SMPOLI', '--list', 'SZO-2026-0001', '--file', 'spis.xlsx', '--expect', '1']).apply, false);
  assert.throws(() => parseArgs(['--tenant', 'SMPOLI', '--list', 'SZO-2026-0001', '--file', 'spis.xlsx', '--expect', '1', '--apply']), /Super Admina/);
  assert.throws(() => parseArgs(['--tenant', 'SMPOLI', '--list', 'SZO-2026-0001', '--file', 'spis.xlsx', '--expect', '0']), /oczekiwana/);
});

test('preview checks full-list identity but never writes', async () => {
  const { db, writes } = setup();
  const result = await reconcileMissingDates(db, input);
  assert.deepEqual(result.positions, [1]);
  assert.equal(result.checked, 2);
  assert.equal(result.pending, 1);
  assert.equal(result.applied, 0);
  assert.equal(writes.length, 0);
});

test('apply guards the row and records source provenance in audit log', async () => {
  const { db, writes } = setup();
  const result = await reconcileMissingDates(db, { ...input, apply: true, actorEmail: 'admin@example.com' });
  assert.equal(result.applied, 1);
  assert.equal(writes[0].where.dateRangeUnknown, false);
  assert.equal(writes[0].where.transferList.is.status, 'draft');
  assert.equal(writes[0].where.transferList.is.legalHold, false);
  assert.equal(writes[0].where.folder.is.tenantId, 'tenant-1');
  assert.deepEqual(writes[0].data, { dateRangeUnknown: true });
  assert.equal(writes[1].data.userId, 'actor-1');
  assert.equal(writes[1].data.newValues.sourceRow, 5);
  assert.equal(writes[1].data.newValues.sourceSha256, 'hash');
});

test('mismatch, filled date, wrong count or stale update abort before audit', async () => {
  for (const change of [
    { row: { folderTitle: 'Zmieniony tytul' } },
    { row: { dateTo: new Date('2022-12-31') } },
    { row: { folder: { id: 'folder-1', tenantId: 'tenant-1', folderNumber: 'A/1', title: 'Teczka 1', dateFrom: null, dateTo: new Date('2022-12-31'), legalHold: false } } },
    { row: { folder: { id: 'folder-1', tenantId: 'tenant-1', folderNumber: 'A/1', title: 'Teczka 1', dateFrom: null, dateTo: null, legalHold: true } } },
    { list: { status: 'confirmed' } },
    { list: { legalHold: true } },
    { lists: [] },
    { lists: [{ id: 'list-1' }, { id: 'list-2' }] },
  ]) {
    const { db, writes } = setup(change);
    await assert.rejects(reconcileMissingDates(db, input));
    assert.equal(writes.length, 0);
  }
  const { db, writes } = setup({ updateCount: 0 });
  await assert.rejects(reconcileMissingDates(db, { ...input, apply: true, actorEmail: 'admin@example.com' }), /zmienila sie/);
  assert.equal(writes.length, 1);
  const unauthorized = setup({ role: 'DA' });
  await assert.rejects(reconcileMissingDates(unauthorized.db, { ...input, apply: true, actorEmail: 'admin@example.com' }), /Super Adminem/);
  assert.equal(unauthorized.writes.length, 0);
  await assert.rejects(reconcileMissingDates(db, { ...input, expect: 2 }), /oczekiwano 2/);
});

test('already marked records can be checked again without duplicate writes', async () => {
  const { db, writes } = setup({ row: { dateRangeUnknown: true } });
  const result = await reconcileMissingDates(db, { ...input, apply: true, actorEmail: 'admin@example.com' });
  assert.equal(result.alreadyMarked, 1);
  assert.equal(result.pending, 0);
  assert.equal(writes.length, 0);
});
