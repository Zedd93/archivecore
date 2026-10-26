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

test('finds an exact box number inside a natural-language question', async () => {
  const oldSearch = searchService.search;
  try {
    searchService.search = async (_tenantId, query) => {
      assert.equal(query, 'K-2026-000030');
      return { total: 0, results: [] };
    };
    const res = response();
    await searchController.evidence({ tenantId: 'tenant-a', query: { q: 'Gdzie jest karton k-2026-000030?' } }, res, (err) => { throw err; });
    assert.equal(res.statusCode, 200);
  } finally {
    searchService.search = oldSearch;
  }
});

test('finds a folder number in a question without mistaking its box prefix for a box', async () => {
  const oldSearch = searchService.search;
  try {
    searchService.search = async (tenantId, query, options, department) => {
      assert.equal(tenantId, 'tenant-a');
      assert.equal(query, 'K-2026-000030/T-001');
      assert.equal(department, 'Księgowość');
      assert.ok(options.types.includes('folder'));
      return { total: 1, results: [{ id: 'folder-1', type: 'folder', title: 'Teczka', subtitle: 'Karton', metadata: {} }] };
    };
    const res = response();
    await searchController.evidence({ tenantId: 'tenant-a', accessDepartment: 'Księgowość', query: { q: 'Gdzie jest teczka k-2026-000030/t-001?' } }, res, (err) => { throw err; });
    assert.deepEqual(res.body.data.sources.map(({ href }) => href), ['/folders/folder-1']);
  } finally {
    searchService.search = oldSearch;
  }
});

test('ordinary results resolve the same folder number question', async () => {
  const oldSearch = searchService.search;
  try {
    searchService.search = async (_tenantId, query, options) => {
      assert.equal(query, 'K-2026-000030/T-001');
      assert.deepEqual(options.types, ['folder']);
      return { total: 1, results: [] };
    };
    const res = response();
    await searchController.search({ tenantId: 'tenant-a', user: { permissions: [] }, query: { q: 'Pokaż teczkę K-2026-000030/T-001', types: 'folder' } }, res, (err) => { throw err; });
    assert.equal(res.statusCode, 200);
  } finally {
    searchService.search = oldSearch;
  }
});

test('finds an imported transfer-list folder number in a natural question', async () => {
  const oldSearch = searchService.search;
  try {
    searchService.search = async (tenantId, query, options) => {
      assert.equal(tenantId, 'tenant-a');
      assert.equal(query, 'SMG/1473');
      assert.ok(options.types.includes('folder'));
      return { total: 1, results: [{ id: 'folder-1', type: 'folder', title: 'SMG/1473 — Regulaminy', subtitle: 'Spis ZO', metadata: {} }] };
    };
    const res = response();
    await searchController.evidence({ tenantId: 'tenant-a', query: { q: 'Gdzie jest teczka smg/1473?' } }, res, (err) => { throw err; });
    assert.deepEqual(res.body.data.sources.map(({ href }) => href), ['/folders/folder-1']);
  } finally {
    searchService.search = oldSearch;
  }
});

test('does not choose between two imported folder numbers', async () => {
  const oldSearch = searchService.search;
  try {
    const question = 'Gdzie są teczki SMG/1473 i SMG/1474?';
    searchService.search = async (_tenantId, query) => {
      assert.equal(query, question);
      return { total: 0, results: [] };
    };
    const res = response();
    await searchController.evidence({ tenantId: 'tenant-a', query: { q: question } }, res, (err) => { throw err; });
    assert.equal(res.statusCode, 200);
  } finally {
    searchService.search = oldSearch;
  }
});

test('finds a quoted document title in a question while retaining the user scope', async () => {
  const oldSearch = searchService.search;
  try {
    searchService.search = async (tenantId, query, options, department) => {
      assert.equal(tenantId, 'tenant-a');
      assert.equal(query, 'Umowa dzierżawy 2024');
      assert.equal(department, 'Księgowość');
      assert.equal(options.canViewHr, false);
      return { total: 1, results: [{ id: 'document-1', type: 'document', title: 'Umowa dzierżawy 2024', subtitle: 'Karton', metadata: {} }] };
    };
    const res = response();
    await searchController.evidence({ tenantId: 'tenant-a', accessDepartment: 'Księgowość', query: { q: 'Pokaż dokument „Umowa dzierżawy 2024”' } }, res, (err) => { throw err; });
    assert.deepEqual(res.body.data.sources.map(({ href }) => href), ['/documents/document-1']);
  } finally {
    searchService.search = oldSearch;
  }
});

test('ordinary document-only results use a quoted title without searching boxes', async () => {
  const oldSearch = searchService.search;
  try {
    searchService.search = async (_tenantId, query, options) => {
      assert.equal(query, 'Umowa dzierżawy 2024');
      assert.deepEqual(options.types, ['document']);
      return { total: 0, results: [] };
    };
    const res = response();
    await searchController.search({ tenantId: 'tenant-a', user: { permissions: [] }, query: { q: 'Pokaż dokument "Umowa dzierżawy 2024"', types: 'document' } }, res, (err) => { throw err; });
    assert.equal(res.statusCode, 200);
  } finally {
    searchService.search = oldSearch;
  }
});

test('does not choose between two quoted titles or a title and a box number', async () => {
  const oldSearch = searchService.search;
  try {
    const questions = [
      'Szukaj "Umowa 2024" albo "Umowa 2025"',
      'Szukaj "X" albo "Umowa 2024"',
      'Szukaj "Umowa 2024" w kartonie K-2026-000030',
    ];
    let index = 0;
    searchService.search = async (_tenantId, query) => {
      assert.equal(query, questions[index++]);
      return { total: 0, results: [] };
    };
    for (const q of questions) {
      const res = response();
      await searchController.evidence({ tenantId: 'tenant-a', query: { q } }, res, (err) => { throw err; });
      assert.equal(res.statusCode, 200);
    }
    assert.equal(index, questions.length);
  } finally {
    searchService.search = oldSearch;
  }
});

test('a document-only filter does not resolve a folder number to a folder', async () => {
  const oldSearch = searchService.search;
  try {
    const question = 'Gdzie jest teczka K-2026-000030/T-001?';
    searchService.search = async (_tenantId, query, options) => {
      assert.equal(query, question);
      assert.deepEqual(options.types, ['document']);
      return { total: 0, results: [] };
    };
    const res = response();
    await searchController.search({ tenantId: 'tenant-a', user: { permissions: [] }, query: { q: question, types: 'document' } }, res, (err) => { throw err; });
    assert.equal(res.statusCode, 200);
  } finally {
    searchService.search = oldSearch;
  }
});

test('does not guess between two different box numbers', async () => {
  const oldSearch = searchService.search;
  try {
    const question = 'Gdzie są K-2026-000030 i K-2026-000031?';
    searchService.search = async (_tenantId, query) => {
      assert.equal(query, question);
      return { total: 0, results: [] };
    };
    const res = response();
    await searchController.evidence({ tenantId: 'tenant-a', query: { q: question } }, res, (err) => { throw err; });
    assert.equal(res.statusCode, 200);
  } finally {
    searchService.search = oldSearch;
  }
});

test('ordinary results resolve the same box question when boxes are included', async () => {
  const oldSearch = searchService.search;
  try {
    searchService.search = async (_tenantId, query, options) => {
      assert.equal(query, 'K-2026-000030');
      assert.ok(options.types.includes('box'));
      return { total: 1, results: [] };
    };
    const res = response();
    await searchController.search({ tenantId: 'tenant-a', user: { permissions: [] }, query: { q: 'Gdzie jest karton K-2026-000030?' } }, res, (err) => { throw err; });
    assert.equal(res.statusCode, 200);
  } finally {
    searchService.search = oldSearch;
  }
});

test('a document-only filter does not resolve a box question to a box', async () => {
  const oldSearch = searchService.search;
  try {
    const question = 'Gdzie jest karton K-2026-000030?';
    searchService.search = async (_tenantId, query, options) => {
      assert.equal(query, question);
      assert.deepEqual(options.types, ['document']);
      return { total: 0, results: [] };
    };
    const res = response();
    await searchController.search({ tenantId: 'tenant-a', user: { permissions: [] }, query: { q: question, types: 'document' } }, res, (err) => { throw err; });
    assert.equal(res.statusCode, 200);
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

test('an exact box number does not bypass a document-only filter', async () => {
  const originalBox = prisma.box.findMany;
  const originalDocument = prisma.document.findMany;
  const originalAttachment = prisma.attachment.findMany;
  try {
    prisma.box.findMany = async () => { throw new Error('box search must not run'); };
    prisma.document.findMany = async () => [];
    prisma.attachment.findMany = async () => [];
    const result = await searchService.search('tenant-a', 'K-2026-000030', {
      types: ['document'], canViewHr: false, limit: 10, offset: 0,
    });
    assert.deepEqual(result, { results: [], total: 0 });
  } finally {
    prisma.box.findMany = originalBox;
    prisma.document.findMany = originalDocument;
    prisma.attachment.findMany = originalAttachment;
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
