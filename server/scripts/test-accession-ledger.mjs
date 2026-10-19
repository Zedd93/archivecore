import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { prisma } = require('../dist/config/database.js');
const { parseLedgerOptions, getAccessionLedger, getAccessionLedgerExport, buildAccessionLedgerCsv } = require('../dist/modules/reports/accession-ledger.service.js');

test('ledger accepts bounded year, kind and pagination filters', () => {
  const now = new Date('2026-10-19T12:00:00Z');
  assert.deepEqual(parseLedgerOptions({ year: '2025', kind: 'disposal', page: '2', pageSize: '50' }, now), {
    year: 2025, kind: 'disposal', page: 2, pageSize: 50,
  });
  for (const query of [{ year: '1999' }, { year: '2027' }, { page: '0' }, { pageSize: '500' }, { kind: 'move' }]) {
    assert.throws(() => parseLedgerOptions(query, now), { statusCode: 400 });
  }
  assert.equal(parseLedgerOptions({}, new Date('2025-12-31T23:30:00Z')).year, 2026);
});

test('ledger queries real receipts and completed disposal snapshots within the selected tenant and year', async () => {
  const original = prisma.$queryRaw;
  const queries = [];
  prisma.$queryRaw = async (query) => {
    queries.push(query);
    return queries.length === 1 ? [{ acquisitions: 3n, disposals: 2n }] : [{
      kind: 'disposal', eventId: 'event:box', eventAt: new Date('2026-10-10T10:00:00Z'),
      boxId: 'box', boxNumber: '1', title: 'Tytuł', location: 'Półka', reference: 'PROT-1',
    }];
  };
  try {
    const result = await getAccessionLedger('11111111-1111-1111-1111-111111111111', { year: 2026, kind: 'disposal', page: 2, pageSize: 25 });
    assert.equal(result.total, 2);
    assert.equal(result.acquisitions, 3);
    assert.equal(result.data[0].reference, 'PROT-1');
    assert.equal(queries.length, 2);
    for (const query of queries) {
      assert.match(query.sql, /c\."eventType" = 'receipt'/);
      assert.match(query.sql, /created\.action = 'box\.create'/);
      assert.match(query.sql, /a\.action = 'box\.create'/);
      assert.match(query.sql, /a\.action = 'disposal\.batch_completed'/);
      assert.match(query.sql, /b\."tenantId" = \?::uuid/);
      assert.match(query.sql, /a\."tenantId" = \?::uuid/);
      assert.equal(query.values.filter((value) => value === '11111111-1111-1111-1111-111111111111').length, 3);
    }
    assert.match(queries[1].sql, /WHERE kind = \?/);
    assert.ok(queries[1].values.includes(25));
  } finally {
    prisma.$queryRaw = original;
  }
});

test('CSV uses a BOM, quotes data and neutralizes spreadsheet formulas', () => {
  const csv = buildAccessionLedgerCsv([{
    kind: 'acquisition', eventId: 'event-id', eventAt: new Date('2026-10-10T10:00:00Z'),
    boxId: 'box-id', boxNumber: '=SUM(1)', title: 'Opis; "ważny"', location: null, reference: '@external',
  }]).toString('utf8');
  assert.ok(csv.startsWith('\uFEFF'));
  assert.match(csv, /"'=SUM\(1\)"/);
  assert.match(csv, /"Opis; ""ważny"""/);
  assert.match(csv, /"'@external"/);
});

test('export refuses to silently truncate an oversized register', async () => {
  const original = prisma.$queryRaw;
  prisma.$queryRaw = async () => Array.from({ length: 20001 }, () => ({}));
  try {
    await assert.rejects(() => getAccessionLedgerExport('tenant-id', { year: 2026, kind: null, page: 1, pageSize: 25 }), { statusCode: 413 });
  } finally {
    prisma.$queryRaw = original;
  }
});
