const test = require('node:test');
const assert = require('node:assert/strict');
const { Permissions, RoleCode } = require('@archivecore/shared');
const { readableSemanticSources } = require('../dist/modules/search/semantic-access.service');

const TENANT = '11111111-1111-4111-8111-111111111111';
const FOLDER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const LIST = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const candidates = [{ type: 'folder', id: FOLDER }, { type: 'transfer_list', id: LIST }];

function database() {
  const calls = [];
  return {
    calls,
    folder: { findMany: async (args) => { calls.push(['folder', args]); return [{ id: FOLDER }]; } },
    transferList: { findMany: async (args) => { calls.push(['list', args]); return [{ id: LIST }]; } },
  };
}

test('department employee can only receive a live folder in their own box', async () => {
  const db = database();
  const result = await readableSemanticSources(candidates, {
    tenantId: TENANT, department: 'Księgowość', roles: [RoleCode.TENANT_EMPLOYEE],
    permissions: [Permissions.SEARCH_OWN, Permissions.FOLDER_READ, Permissions.TRANSFER_LIST_READ],
  }, db);
  assert.deepEqual(result, [{ type: 'folder', id: FOLDER }]);
  assert.equal(db.calls.length, 1);
  const where = db.calls[0][1].where;
  assert.equal(where.tenantId, TENANT);
  assert.deepEqual(where.id.in, [FOLDER]);
  assert.equal(where.status.not, 'disposed');
  assert.equal(where.box.is.tenantId, TENANT);
  assert.equal(where.box.is.deletedAt, null);
  assert.deepEqual(where.box.is.status.notIn, ['disposed', 'lost']);
  assert.deepEqual(where.box.is.department, { equals: 'Księgowość', mode: 'insensitive' });
});

test('tenant leadership may receive a list and a live folder', async () => {
  const db = database();
  const result = await readableSemanticSources(candidates, {
    tenantId: TENANT, roles: [RoleCode.TENANT_LEADERSHIP],
    permissions: [Permissions.SEARCH_OWN, Permissions.FOLDER_READ, Permissions.TRANSFER_LIST_READ],
  }, db);
  assert.deepEqual(result, candidates);
  assert.equal(db.calls.length, 2);
  assert.deepEqual(db.calls[0][1].where.OR[0], { boxId: null });
  assert.equal(db.calls[1][1].where.tenantId, TENANT);
});

test('missing read permissions never query the records', async () => {
  const db = database();
  const result = await readableSemanticSources(candidates, {
    tenantId: TENANT, roles: [], permissions: [Permissions.SEARCH_OWN],
  }, db);
  assert.deepEqual(result, []);
  assert.deepEqual(db.calls, []);
});

test('missing search permission or employee department fails closed', async () => {
  const db = database();
  assert.deepEqual(await readableSemanticSources(candidates, {
    tenantId: TENANT, roles: [], permissions: [Permissions.FOLDER_READ],
  }, db), []);
  assert.deepEqual(await readableSemanticSources(candidates, {
    tenantId: TENANT, roles: [RoleCode.TENANT_EMPLOYEE],
    permissions: [Permissions.SEARCH_OWN, Permissions.FOLDER_READ],
  }, db), []);
  assert.deepEqual(await readableSemanticSources(candidates, {
    tenantId: TENANT, department: '   ', roles: [],
    permissions: [Permissions.SEARCH_ALL, Permissions.FOLDER_READ],
  }, db), []);
  assert.deepEqual(db.calls, []);
});

test('stale, foreign and duplicate candidates are not returned', async () => {
  const db = database();
  db.folder.findMany = async (args) => {
    db.calls.push(['folder', args]);
    return [];
  };
  const result = await readableSemanticSources([
    { type: 'folder', id: FOLDER }, { type: 'folder', id: FOLDER },
    { type: 'transfer_list', id: LIST, title: 'Nie ujawniaj tytulu z indeksu', score: 0.99 },
    { type: 'folder', id: 'invalid-id' },
  ], {
    tenantId: TENANT, roles: [],
    permissions: [Permissions.SEARCH_ALL, Permissions.FOLDER_READ, Permissions.TRANSFER_LIST_READ],
  }, db);
  assert.deepEqual(result, [{ type: 'transfer_list', id: LIST }]);
  assert.deepEqual(db.calls[0][1].where.id.in, [FOLDER]);
});

test('invalid tenant and unbounded candidates are rejected', async () => {
  const db = database();
  await assert.rejects(readableSemanticSources(candidates, {
    tenantId: 'invalid', roles: [], permissions: [Permissions.SEARCH_ALL],
  }, db), /tenanta/);
  await assert.rejects(readableSemanticSources(Array(101).fill(candidates[0]), {
    tenantId: TENANT, roles: [], permissions: [Permissions.SEARCH_ALL],
  }, db), /Za duzo/);
  assert.deepEqual(db.calls, []);
});
