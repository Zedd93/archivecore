const assert = require('node:assert/strict');
const test = require('node:test');
const { parseEvaluationArgs, parseCases, evaluateCases } = require('./evaluate-semantic-metadata.cjs');

const folderId = '00000000-0000-0000-0000-000000000001';
const listId = '00000000-0000-0000-0000-000000000002';
const vector = (first) => [first, 1 - first, ...Array(1022).fill(0)];

function fakeDb() {
  const calls = [];
  return {
    calls,
    tenant: { findFirst: async (args) => {
      calls.push(['tenant', args]);
      return { id: 'tenant-a', shortCode: 'ABC' };
    } },
    folder: { findMany: async (args) => {
      calls.push(['folder', args]);
      return [{ id: folderId, folderNumber: 'T-1', title: 'Faktury', description: null,
        docType: null, transferListItem: null }];
    } },
    transferList: { findMany: async (args) => {
      calls.push(['list', args]);
      return [{ id: listId, listNumber: 'SZO-1', title: 'Akta osobowe',
        transferringUnit: null, notes: null }];
    } },
  };
}

test('requires bounded arguments and well-formed evaluation cases', () => {
  assert.throws(() => parseEvaluationArgs(['--tenant', 'ABC']), /--file/);
  assert.throws(() => parseEvaluationArgs(['--tenant', 'ABC', '--file', 'cases.json', '--max', '201']), /--max/);
  assert.deepEqual(parseEvaluationArgs(['--tenant', 'ABC', '--file', 'cases.json']).max, 100);
  assert.throws(() => parseCases('[null]'), /Kazdy przypadek/);
  assert.throws(() => parseCases('[{"query":"abc","relevant":[{"type":"folder","id":"bad"}]}]'), /UUID/);
  assert.equal(parseCases(JSON.stringify([{ query: 'faktury', relevant: [{ type: 'folder', id: folderId }] }])).length, 1);
});

test('scores scoped results and embeds metadata only once for multiple queries', async () => {
  const db = fakeDb();
  const requests = [];
  const embed = async (texts) => {
    requests.push(texts);
    return texts.map((text) => vector(text.includes('Faktury') || text.includes('faktury') ? 1 : 0));
  };
  const cases = [
    { query: 'faktury', relevant: [{ type: 'folder', id: folderId }] },
    { query: 'akta osobowe', relevant: [{ type: 'transfer_list', id: listId }] },
  ];
  const { summary, results } = await evaluateCases(db, { tenantCode: 'ABC', max: 20, top: 1 }, cases, embed);
  assert.equal(summary.hitRate, 1);
  assert.equal(summary.meanRecall, 1);
  assert.equal(summary.mrr, 1);
  assert.deepEqual(requests.map((batch) => batch.length), [2, 2]);
  assert.ok(db.calls.slice(1).every(([, args]) => args.where.tenantId === 'tenant-a'));
  assert.deepEqual(results.map((result) => result.top[0].type), ['folder', 'transfer_list']);
});

test('missing expected record fails before calling the local model', async () => {
  const db = fakeDb();
  await assert.rejects(evaluateCases(db, { tenantCode: 'ABC', max: 20, top: 1 }, [
    { query: 'faktury', relevant: [{ type: 'folder', id: '00000000-0000-0000-0000-000000000099' }] },
  ], () => { throw new Error('Unexpected model call'); }), /nie jest w probce/);
});

test('department evaluation never loads standalone transfer lists', async () => {
  const db = fakeDb();
  const result = await evaluateCases(db, { tenantCode: 'ABC', department: 'Ksiegowosc', max: 20, top: 1 }, [
    { query: 'faktury', relevant: [{ type: 'folder', id: folderId }] },
  ], async (texts) => texts.map(() => vector(1)));
  assert.equal(result.summary.hitRate, 1);
  assert.deepEqual(db.calls.map(([kind]) => kind), ['tenant', 'folder']);
  assert.equal(db.calls[1][1].where.box.is.department.equals, 'Ksiegowosc');
});
