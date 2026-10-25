const test = require('node:test');
const assert = require('node:assert/strict');
const { searchController } = require('../dist/modules/search/search.controller');
const { searchService } = require('../dist/modules/search/search.service');

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
