const test = require('node:test');
const assert = require('node:assert/strict');
const { searchController } = require('../dist/modules/search/search.controller');
const { searchService } = require('../dist/modules/search/search.service');
const { prisma } = require('../dist/config/database');
const { tenantContext } = require('../dist/middleware/tenant');
const { RoleCode } = require('@archivecore/shared');

function response() {
  return {
    statusCode: 200,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name] = value; },
    json(body) { this.body = body; return this; },
  };
}

test('retrieves only scoped, linkable non-HR sources and hides raw metadata', async () => {
  const oldSearch = searchService.search;
  try {
    searchService.search = async (tenantId, query, options, department) => {
      assert.equal(tenantId, 'tenant-a');
      assert.equal(query, 'umowa');
      assert.equal(department, 'Księgowość');
      assert.deepEqual(options, {
        types: ['box', 'folder', 'document'], canViewHr: false, limit: 10, offset: 0,
      });
      return { total: 5, results: [
        { id: 'box-1', type: 'box', title: 'Karton', subtitle: 'Półka', metadata: { secret: 'hidden' } },
        { id: 'folder-1', type: 'folder', title: 'Teczka', subtitle: 'Karton', metadata: {} },
        { id: 'attachment-1', type: 'document', title: 'Skan', subtitle: 'Teczka', metadata: { source: 'attachment', folderId: 'folder-1', ocrText: 'sensitive' } },
        { id: 'hr-1', type: 'hr_folder', title: 'Akta osobowe', subtitle: '', metadata: {} },
        { id: 'hr-doc-1', type: 'document', title: 'Akta osobowe', subtitle: '', metadata: { source: 'hr_document' } },
      ] };
    };
    const res = response();
    let error;
    await searchController.evidence({ tenantId: 'tenant-a', accessDepartment: 'Księgowość', query: { q: 'umowa', types: 'hr_folder', limit: '100' } }, res, (err) => { error = err; });
    assert.equal(error, undefined);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Cache-Control'], 'private, no-store');
    assert.deepEqual(res.body.data.sources.map(({ type, href }) => [type, href]), [
      ['box', '/boxes/box-1'], ['folder', '/folders/folder-1'], ['attachment', '/folders/folder-1'],
    ]);
    assert.equal(JSON.stringify(res.body).includes('sensitive'), false);
    assert.equal(JSON.stringify(res.body).includes('Akta osobowe'), false);
    assert.equal(JSON.stringify(res.body).includes('secret'), false);
  } finally {
    searchService.search = oldSearch;
  }
});

test('refuses to retrieve sources without tenant context', async () => {
  const oldSearch = searchService.search;
  let called = false;
  try {
    searchService.search = async () => { called = true; throw new Error('must not run'); };
    const res = response();
    await searchController.evidence({ tenantId: null, query: { q: 'umowa' } }, res, () => {});
    assert.equal(res.statusCode, 400);
    assert.equal(called, false);
  } finally {
    searchService.search = oldSearch;
  }
});

test('scopes every evidence query to the tenant and employee department', async () => {
  const models = ['box', 'folder', 'document', 'attachment'];
  const originals = new Map();
  const queries = new Map();
  try {
    for (const model of models) {
      originals.set(model, prisma[model].findMany);
      prisma[model].findMany = async (args) => {
        queries.set(model, args.where);
        return [];
      };
    }

    const result = await searchService.search('tenant-a', 'umowa', {
      types: ['box', 'folder', 'document'], canViewHr: false, limit: 10, offset: 0,
    }, 'Księgowość');

    assert.deepEqual(result, { results: [], total: 0 });
    assert.deepEqual([...queries.keys()].sort(), models.sort());
    for (const where of queries.values()) assert.equal(where.tenantId, 'tenant-a');
    assert.equal(queries.get('box').deletedAt, null);
    assert.deepEqual(queries.get('box').department, { equals: 'Księgowość', mode: 'insensitive' });
    assert.deepEqual(queries.get('folder').box.is.department, { equals: 'Księgowość', mode: 'insensitive' });
    assert.equal(queries.get('document').OR.length, 2);
    assert.equal(queries.get('document').OR[0].box.department.equals, 'Księgowość');
    assert.equal(queries.get('document').OR[1].folder.box.department.equals, 'Księgowość');
    assert.equal(queries.get('attachment').OR.length, 4);
    assert.equal(queries.get('attachment').OR[0].box.department.equals, 'Księgowość');
    assert.equal(queries.get('attachment').OR[1].folder.box.department.equals, 'Księgowość');
    assert.equal(queries.get('attachment').OR[2].document.box.department.equals, 'Księgowość');
    assert.equal(queries.get('attachment').OR[3].document.folder.box.department.equals, 'Księgowość');
  } finally {
    for (const model of models) prisma[model].findMany = originals.get(model);
  }
});

test('scopes exact box numbers to the tenant and employee department', async () => {
  const original = prisma.box.findMany;
  try {
    prisma.box.findMany = async ({ where }) => {
      assert.equal(where.tenantId, 'tenant-a');
      assert.equal(where.deletedAt, null);
      assert.deepEqual(where.department, { equals: 'Księgowość', mode: 'insensitive' });
      return [{ id: 'box-1', boxNumber: 'K-2026-000030', title: 'Karton', location: null }];
    };
    const result = await searchService.search('tenant-a', 'K-2026-000030', {
      types: ['box', 'folder', 'document'], canViewHr: false, limit: 10, offset: 0,
    }, 'Księgowość');
    assert.equal(result.results[0].id, 'box-1');
  } finally {
    prisma.box.findMany = original;
  }
});

test('employee context ignores a requested tenant switch and carries its department', () => {
  const req = {
    user: {
      tenantId: 'tenant-a', department: 'Księgowość', roles: [RoleCode.TENANT_EMPLOYEE], permissions: [],
    },
    headers: { 'x-tenant-id': 'tenant-b' },
  };
  let nextCalled = false;
  tenantContext(req, response(), () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(req.tenantId, 'tenant-a');
  assert.equal(req.accessDepartment, 'Księgowość');
});
