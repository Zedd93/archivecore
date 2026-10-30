const assert = require('node:assert/strict');
const test = require('node:test');
const { parseArgs, loadMetadata, loadMetadataForContext, embedLocal, runPilot, EMBED_URL } = require('./semantic-metadata-pilot.cjs');

const tenantId = '00000000-0000-0000-0000-000000000001';
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
          transferList: { tenantId, title: 'Spis finansowy', listNumber: 'SZO-1' } } }];
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
  assert.equal(calls[1][1].where.box.is.tenantId, tenantId);
});

test('authenticated context requires tenant ID before any metadata query', async () => {
  const { db, calls } = fakeDb();
  await assert.rejects(loadMetadataForContext(db, { max: 20 }), /identyfikatora tenanta/);
  await assert.rejects(loadMetadataForContext(db, { tenantId: 'bad', max: 20 }), /identyfikatora tenanta/);
  await assert.rejects(loadMetadataForContext(db, { tenantId, max: 201 }), /Limit probki/);
  await assert.rejects(loadMetadataForContext(db, { tenantId, max: 20, department: '' }), /Filtr dzialu/);
  assert.equal(calls.length, 0);
});

test('authenticated context uses its tenant ID directly and never resolves a user-supplied code', async () => {
  const { db, calls } = fakeDb();
  const records = await loadMetadataForContext(db, { tenantId, max: 20 });
  assert.equal(records.length, 2);
  assert.deepEqual(calls.map(([kind]) => kind), ['folder', 'list']);
  assert.equal(calls[0][1].where.tenantId, tenantId);
  assert.equal(calls[0][1].where.OR[1].box.is.tenantId, tenantId);
  assert.equal(calls[1][1].where.tenantId, tenantId);
});

test('linked list title is not embedded if its tenant differs from the authenticated context', async () => {
  const { db } = fakeDb();
  db.folder.findMany = async () => [{ id: 'folder-a', folderNumber: 'T-1', title: 'Faktury',
    description: null, docType: null, transferListItem: { folderTitle: 'Sekret obcego klienta', categoryCode: 'B10',
      transferList: { tenantId: '00000000-0000-0000-0000-000000000002', title: 'Tajny spis' } } }];
  const records = await loadMetadataForContext(db, { tenantId, max: 20 });
  assert.equal(records[0].text.includes('Tajny spis'), false);
  assert.equal(records[0].text.includes('Sekret obcego klienta'), false);
});

test('department context does not embed a list title shared with other departments', async () => {
  const { db } = fakeDb();
  db.folder.findMany = async () => [{ id: 'folder-a', folderNumber: 'T-1', title: 'Faktury',
    description: null, docType: null, transferListItem: { folderTitle: 'Faktury', categoryCode: 'B10',
      transferList: { tenantId, title: 'Spis wielu dzialow', listNumber: 'SZO-1' } } }];
  const records = await loadMetadataForContext(db, { tenantId, department: 'Ksiegowosc', max: 20 });
  assert.equal(records.length, 1);
  assert.equal(records[0].text.includes('Spis wielu dzialow'), false);
  assert.equal(records[0].text.includes('Faktury'), true);
});

test('unrestricted pilot reads only the chosen tenant and ranks local embeddings', async () => {
  const { db, calls } = fakeDb();
  const embed = async (texts) => texts.map((text) => text.includes('Faktury') ? [1, 0] : [0, 1]);
  const result = await runPilot(db, { tenantCode: 'ABC', query: 'Faktury', max: 20, top: 2 }, embed);
  assert.deepEqual(result.results.map((row) => row.type), ['folder', 'transfer_list']);
  assert.ok(calls.slice(1).every(([, args]) => args.where.tenantId === tenantId));
  assert.equal(result.results[0].score, 1);
});

test('full folder sample still reserves room for a transfer list', async () => {
  const { db, calls } = fakeDb();
  db.folder.findMany = async (args) => {
    calls.push(['folder', args]);
    return Array.from({ length: args.take }, (_, index) => ({
      id: `folder-${index}`, folderNumber: `T-${index}`, title: `Teczka ${index}`,
      description: null, docType: null, transferListItem: null,
    }));
  };
  db.transferList.findMany = async (args) => {
    calls.push(['list', args]);
    return Array.from({ length: args.take }, (_, index) => ({
      id: `list-${index}`, listNumber: `SZO-${index}`, title: `Spis ${index}`,
      transferringUnit: null, notes: null,
    }));
  };
  const result = await loadMetadata(db, { tenantCode: 'ABC', max: 20 });
  assert.equal(result.records.length, 20);
  assert.equal(result.records.filter((record) => record.type === 'transfer_list').length, 5);
  assert.equal(result.records.at(-1).type, 'transfer_list');
  assert.equal(calls.find(([kind]) => kind === 'list')[1].take, 5);
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
