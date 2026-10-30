const assert = require('node:assert/strict');
const test = require('node:test');
const { parseArgs, loadMetadata, embedLocal, runPilot, EMBED_URL } = require('./semantic-metadata-pilot.cjs');

const tenantId = 'tenant-a';
function fakeDb() {
  const calls = [];
  const db = {
    tenant: { findFirst: async (args) => {
      calls.push(['tenant', args]);
      return { id: tenantId, shortCode: 'ABC' };
    } },
    folder: { findMany: async (args) => {
      calls.push(['folder', args]);
      return [{ id: 'folder-a', folderNumber: 'T-1', title: 'Faktury', description: 'Ksiegowosc',
        docType: null, transferListItem: { folderTitle: 'Faktury', categoryCode: 'B10',
          transferList: { title: 'Spis finansowy', listNumber: 'SZO-1' } } }];
    } },
    transferList: { findMany: async (args) => {
      calls.push(['list', args]);
      return [{ id: 'list-a', listNumber: 'SZO-1', title: 'Spis finansowy', transferringUnit: null, notes: null }];
    } },
  };
  return { db, calls };
}

test('requires a single tenant and bounded sample', () => {
  assert.throws(() => parseArgs(['--query', 'faktury']), /--tenant/);
  assert.throws(() => parseArgs(['--tenant', 'ABC', '--query', 'x']), /--query/);
  assert.throws(() => parseArgs(['--tenant', 'ABC', '--query', 'faktury', '--max', '201']), /--max/);
  assert.equal(parseArgs(['--tenant', 'ABC', '--dry-run']).dryRun, true);
});

test('department pilot excludes standalone lists and filters folders at the database', async () => {
  const { db, calls } = fakeDb();
  const result = await loadMetadata(db, { tenantCode: 'ABC', department: 'Ksiegowosc', max: 20 });
  assert.equal(result.records.length, 1);
  assert.deepEqual(calls.map(([kind]) => kind), ['tenant', 'folder']);
  assert.equal(calls[1][1].where.tenantId, tenantId);
  assert.equal(calls[1][1].where.box.is.department.equals, 'Ksiegowosc');
  assert.equal(calls[1][1].where.box.is.deletedAt, null);
});

test('unrestricted pilot reads only the chosen tenant and ranks local embeddings', async () => {
  const { db, calls } = fakeDb();
  const embed = async (texts) => texts.map((text) => text.includes('Faktury') ? [1, 0] : [0, 1]);
  const result = await runPilot(db, { tenantCode: 'ABC', query: 'Faktury', max: 20, top: 2 }, embed);
  assert.deepEqual(result.results.map((row) => row.type), ['folder', 'transfer_list']);
  assert.ok(calls.slice(1).every(([, args]) => args.where.tenantId === tenantId));
  assert.equal(result.results[0].score, 1);
});

test('dry run never calls the embedding service', async () => {
  const { db } = fakeDb();
  const result = await runPilot(db, { tenantCode: 'ABC', dryRun: true, max: 20 }, () => {
    throw new Error('Unexpected model call');
  });
  assert.equal(result.records, 2);
});

test('embedding service is fixed to loopback and rejects bad dimensions', async () => {
  await assert.rejects(embedLocal(['tekst'], async (url) => {
    assert.equal(url, EMBED_URL);
    return { ok: true, json: async () => ({ embeddings: [[1, 2]] }) };
  }), /niepoprawne wektory/);
});
