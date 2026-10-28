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

    assert.deepEqual(result, { results: [], total: 0, hasMore: false });
    assert.deepEqual([...queries.keys()].sort(), models.sort());
    for (const where of queries.values()) assert.equal(where.tenantId, 'tenant-a');
    assert.equal(queries.get('box').deletedAt, null);
    assert.deepEqual(queries.get('box').department, { equals: 'Księgowość', mode: 'insensitive' });
    assert.deepEqual(queries.get('folder').box.is.department, { equals: 'Księgowość', mode: 'insensitive' });
    assert.equal(queries.get('document').OR.length, 2);
    assert.deepEqual(queries.get('document').OR[0].folderId, { not: null });
    assert.equal(queries.get('document').OR[0].folder.box.department.equals, 'Księgowość');
    assert.equal(queries.get('document').OR[1].folderId, null);
    assert.equal(queries.get('document').OR[1].box.department.equals, 'Księgowość');
    assert.equal(queries.get('attachment').OR.length, 4);
    assert.deepEqual(queries.get('attachment').OR[0].documentId, { not: null });
    assert.deepEqual(queries.get('attachment').OR[0].document.folderId, { not: null });
    assert.equal(queries.get('attachment').OR[0].document.folder.box.department.equals, 'Księgowość');
    assert.equal(queries.get('attachment').OR[1].document.folderId, null);
    assert.equal(queries.get('attachment').OR[1].document.box.department.equals, 'Księgowość');
    assert.equal(queries.get('attachment').OR[2].documentId, null);
    assert.deepEqual(queries.get('attachment').OR[2].folderId, { not: null });
    assert.equal(queries.get('attachment').OR[2].folder.box.department.equals, 'Księgowość');
    assert.equal(queries.get('attachment').OR[3].documentId, null);
    assert.equal(queries.get('attachment').OR[3].folderId, null);
    assert.equal(queries.get('attachment').OR[3].box.department.equals, 'Księgowość');
    assert.deepEqual(queries.get('attachment').AND[1].OR, [
      { documentId: { not: null } },
      { folderId: { not: null } },
      { boxId: { not: null } },
    ]);
  } finally {
    for (const model of models) prisma[model].findMany = originals.get(model);
  }
});

test('does not expose HR-only or orphan attachments as unopenable search sources', async () => {
  const originalAttachment = prisma.attachment.findMany;
  const originalDocument = prisma.document.findMany;
  try {
    prisma.document.findMany = async () => [];
    prisma.attachment.findMany = async ({ where }) => {
      assert.equal(where.tenantId, 'tenant-a');
      assert.deepEqual(where.AND[1].OR, [
        { documentId: { not: null } },
        { folderId: { not: null } },
        { boxId: { not: null } },
      ]);
      return [];
    };
    const result = await searchService.search('tenant-a', 'scan', {
      types: ['document'], canViewHr: false, limit: 10,
    });
    assert.deepEqual(result.results, []);
  } finally {
    prisma.attachment.findMany = originalAttachment;
    prisma.document.findMany = originalDocument;
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

test('ranks an older exact box title ahead of newer partial matches within the department', async () => {
  const original = prisma.box.findMany;
  try {
    const box = (id, title) => ({
      id, boxNumber: `BOX-${id}`, title, description: null, notes: null,
      docType: null, status: 'active', location: null,
    });
    prisma.box.findMany = async ({ where, take }) => {
      assert.equal(where.tenantId, 'tenant-a');
      assert.equal(where.deletedAt, null);
      assert.deepEqual(where.department, { equals: 'Księgowość', mode: 'insensitive' });
      assert.equal(take, 11);
      if (where.OR[0].title?.equals) {
        assert.equal(where.OR[0].title.equals, 'Karton 1');
        return [box('exact', 'Karton 1')];
      }
      return Array.from({ length: 10 }, (_, index) => box(`newer-${index}`, `Karton 1${index}`));
    };
    const result = await searchService.search('tenant-a', 'Karton 1', { types: ['box'], limit: 10 }, 'Księgowość');
    assert.equal(result.results[0].id, 'exact');
    assert.equal(result.total, 11);
  } finally {
    prisma.box.findMany = original;
  }
});

test('deduplicates a box found by both exact and partial searches', async () => {
  const original = prisma.box.findMany;
  try {
    prisma.box.findMany = async () => [{
      id: 'box-1', boxNumber: 'BOX-1', title: 'Karton 1', description: null,
      notes: null, docType: null, status: 'active', location: null,
    }];
    const result = await searchService.search('tenant-a', 'Karton 1', { types: ['box'] });
    assert.equal(result.total, 1);
    assert.equal(result.results.length, 1);
  } finally {
    prisma.box.findMany = original;
  }
});

test('continues ranked search beyond the first page without skipping scoped records', async () => {
  const original = prisma.box.findMany;
  try {
    const boxes = Array.from({ length: 35 }, (_, index) => ({
      id: `box-${String(index + 1).padStart(2, '0')}`,
      boxNumber: `BOX-${index + 1}`,
      title: `Karton testowy ${index + 1}`,
      description: null, notes: null, docType: null, status: 'active', location: null,
    }));
    prisma.box.findMany = async ({ where, take }) => {
      assert.equal(where.tenantId, 'tenant-a');
      assert.equal(where.deletedAt, null);
      assert.deepEqual(where.department, { equals: 'Księgowość', mode: 'insensitive' });
      if (where.OR[0].title?.equals) return [];
      return boxes.slice(0, take);
    };
    const first = await searchService.search('tenant-a', 'Karton testowy', { types: ['box'], limit: 10 }, 'Księgowość');
    const second = await searchService.search('tenant-a', 'Karton testowy', { types: ['box'], limit: 10, offset: 10 }, 'Księgowość');
    const last = await searchService.search('tenant-a', 'Karton testowy', { types: ['box'], limit: 10, offset: 30 }, 'Księgowość');
    assert.deepEqual(first.results.map((result) => result.id), boxes.slice(0, 10).map((box) => box.id));
    assert.deepEqual(second.results.map((result) => result.id), boxes.slice(10, 20).map((box) => box.id));
    assert.deepEqual(last.results.map((result) => result.id), boxes.slice(30).map((box) => box.id));
    assert.equal(first.hasMore, true);
    assert.equal(second.hasMore, true);
    assert.equal(last.hasMore, false);
  } finally {
    prisma.box.findMany = original;
  }
});

test('continues scoped search beyond the first hundred records with fixed page size', async () => {
  const original = prisma.box.findMany;
  try {
    const boxes = Array.from({ length: 125 }, (_, index) => ({
      id: `box-${String(index + 1).padStart(3, '0')}`,
      boxNumber: `BOX-${index + 1}`,
      title: `Karton testowy ${index + 1}`,
      description: null, notes: null, docType: null, status: 'active', location: null,
    }));
    prisma.box.findMany = async ({ where, take }) => {
      assert.equal(where.tenantId, 'tenant-a');
      assert.deepEqual(where.department, { equals: 'Księgowość', mode: 'insensitive' });
      if (where.OR[0].title?.equals) return [];
      return boxes.slice(0, take);
    };
    const pages = [];
    for (let offset = 0; offset < 125; offset += 20) {
      pages.push(await searchService.search('tenant-a', 'Karton testowy', {
        types: ['box'], limit: 20, offset,
      }, 'Księgowość'));
    }
    assert.deepEqual(pages.flatMap((page) => page.results.map((result) => result.id)), boxes.map((box) => box.id));
    assert.equal(pages[4].hasMore, true);
    assert.equal(pages[5].hasMore, true);
    assert.equal(pages[6].hasMore, false);
  } finally {
    prisma.box.findMany = original;
  }
});

test('keeps an older prefix box match on the first page without repeating it on the next', async () => {
  const original = prisma.box.findMany;
  try {
    const box = (id, title) => ({
      id, boxNumber: `BOX-${id}`, title, description: null, notes: null,
      docType: null, status: 'active', location: null,
    });
    const partial = Array.from({ length: 35 }, (_, index) => box(`new-${String(index).padStart(2, '0')}`, `Archiwum Projekt ${index}`));
    const strong = box('old-prefix', 'Projekt celny');
    prisma.box.findMany = async ({ where, take, orderBy }) => {
      assert.equal(where.tenantId, 'tenant-a');
      assert.deepEqual(where.department, { equals: 'Księgowość', mode: 'insensitive' });
      assert.deepEqual(orderBy, { id: 'asc' });
      if (where.OR[0].title?.equals) return [];
      if (where.OR[0].title?.startsWith) return [strong];
      return partial.slice(0, take);
    };
    const first = await searchService.search('tenant-a', 'Projekt', { types: ['box'], limit: 10 }, 'Księgowość');
    const second = await searchService.search('tenant-a', 'Projekt', { types: ['box'], limit: 10, offset: 10 }, 'Księgowość');
    assert.deepEqual(first.results.map((result) => result.id), ['old-prefix', ...partial.slice(0, 9).map((item) => item.id)]);
    assert.deepEqual(second.results.map((result) => result.id), partial.slice(9, 19).map((item) => item.id));
  } finally {
    prisma.box.findMany = original;
  }
});

test('prioritizes an older prefix folder title over newer partial matches', async () => {
  const original = prisma.folder.findMany;
  try {
    const folder = (id, title) => ({
      id, title, folderNumber: `F-${id}`, description: null, docType: null,
      status: 'active', boxId: null, box: null, custodyEvents: [], transferListItem: null,
    });
    const partial = Array.from({ length: 30 }, (_, index) => folder(`new-${String(index).padStart(2, '0')}`, `Archiwum Projekt ${index}`));
    prisma.folder.findMany = async ({ where, take, orderBy }) => {
      assert.equal(where.tenantId, 'tenant-a');
      assert.deepEqual(orderBy, { id: 'asc' });
      if (where.OR[0].folderNumber?.equals) return [];
      if (where.OR[0].title?.startsWith) return [folder('old-prefix', 'Projekt celny')];
      return partial.slice(0, take);
    };
    const first = await searchService.search('tenant-a', 'Projekt', { types: ['folder'], limit: 10 });
    const second = await searchService.search('tenant-a', 'Projekt', { types: ['folder'], limit: 10, offset: 10 });
    assert.equal(first.results[0].id, 'old-prefix');
    assert.deepEqual(second.results.map((result) => result.id), partial.slice(9, 19).map((item) => item.id));
  } finally {
    prisma.folder.findMany = original;
  }
});

test('prioritizes an older prefix scan name without leaking another department', async () => {
  const originalDocument = prisma.document.findMany;
  const originalAttachment = prisma.attachment.findMany;
  try {
    const scan = (id, fileName) => ({
      id, fileName, ocrText: null, mimeType: 'application/pdf', document: null, folder: null,
      box: { id: `box-${id}`, boxNumber: `BOX-${id}`, title: 'Karton',
        department: 'Księgowość', status: 'active', deletedAt: null, location: null },
    });
    const partial = Array.from({ length: 30 }, (_, index) => scan(`new-${String(index).padStart(2, '0')}`, `Kopia plan.pdf ${index}`));
    prisma.document.findMany = async () => [];
    prisma.attachment.findMany = async ({ where, take, orderBy }) => {
      assert.equal(where.tenantId, 'tenant-a');
      assert.equal(where.OR[3].box.department.equals, 'Księgowość');
      assert.deepEqual(orderBy, { id: 'asc' });
      if (where.AND[0].OR[0].fileName?.equals) return [];
      if (where.AND[0].OR[0].fileName?.startsWith) return [scan('old-prefix', 'plan.pdf oryginal')];
      if (where.AND[0].OR[0].ocrText?.contains) return [];
      return partial.slice(0, take);
    };
    const first = await searchService.search('tenant-a', 'plan.pdf', { types: ['document'], limit: 10 }, 'Księgowość');
    const second = await searchService.search('tenant-a', 'plan.pdf', { types: ['document'], limit: 10, offset: 10 }, 'Księgowość');
    assert.equal(first.results[0].id, 'old-prefix');
    assert.deepEqual(second.results.map((result) => result.id), partial.slice(9, 19).map((item) => item.id));
  } finally {
    prisma.document.findMany = originalDocument;
    prisma.attachment.findMany = originalAttachment;
  }
});

test('ranks an older exact attachment filename ahead of newer partial matches within the department', async () => {
  const originalDocument = prisma.document.findMany;
  const originalAttachment = prisma.attachment.findMany;
  try {
    const attachment = (id, fileName) => ({
      id, fileName, ocrText: null, mimeType: 'application/pdf', document: null,
      folder: null, box: { id: 'box-1', boxNumber: 'K-2026-000001', title: 'Karton',
        department: 'Księgowość', status: 'active', deletedAt: null, location: null },
    });
    prisma.document.findMany = async () => [];
    prisma.attachment.findMany = async ({ where, take }) => {
      assert.equal(where.tenantId, 'tenant-a');
      assert.equal(where.OR.length, 4);
      assert.equal(where.OR[3].box.department.equals, 'Księgowość');
      assert.equal(take, 11);
      if (where.AND[0].OR[0].ocrText?.contains) return [];
      if (where.AND[0].OR[0].fileName.equals) {
        assert.equal(where.AND[0].OR[0].fileName.equals, 'Skan.pdf');
        return [attachment('exact-scan', 'Skan.pdf')];
      }
      return Array.from({ length: 10 }, (_, index) => attachment(`newer-${index}`, `Skan.pdf - kopia ${index}`));
    };
    const result = await searchService.search('tenant-a', 'Skan.pdf', { types: ['document'], limit: 10 }, 'Księgowość');
    assert.equal(result.results[0].id, 'exact-scan');
    assert.equal(result.results[0].metadata.source, 'attachment');
    assert.equal(result.total, 11);
  } finally {
    prisma.document.findMany = originalDocument;
    prisma.attachment.findMany = originalAttachment;
  }
});

test('deduplicates an attachment found by both exact and partial searches', async () => {
  const originalDocument = prisma.document.findMany;
  const originalAttachment = prisma.attachment.findMany;
  try {
    prisma.document.findMany = async () => [];
    prisma.attachment.findMany = async () => [{
      id: 'scan-1', fileName: 'Skan.pdf', ocrText: null, mimeType: 'application/pdf',
      document: null, folder: null, box: null,
    }];
    const result = await searchService.search('tenant-a', 'Skan.pdf', { types: ['document'] });
    assert.equal(result.total, 1);
    assert.equal(result.results.length, 1);
  } finally {
    prisma.document.findMany = originalDocument;
    prisma.attachment.findMany = originalAttachment;
  }
});

test('keeps an older OCR match ahead of newer indirect matches within the department', async () => {
  const originalDocument = prisma.document.findMany;
  const originalAttachment = prisma.attachment.findMany;
  try {
    const attachment = (id, ocrText, boxTitle) => ({
      id, fileName: `scan-${id}.pdf`, ocrText, mimeType: 'application/pdf',
      document: null, folder: null,
      box: { id: `box-${id}`, boxNumber: `BOX-${id}`, title: boxTitle,
        department: 'Księgowość', status: 'active', deletedAt: null, location: null },
    });
    prisma.document.findMany = async () => [];
    prisma.attachment.findMany = async ({ where, take }) => {
      assert.equal(where.tenantId, 'tenant-a');
      assert.equal(where.OR[3].box.department.equals, 'Księgowość');
      assert.equal(take, 11);
      if (where.AND[0].OR[0].fileName?.equals) return [];
      if (where.AND[0].OR[0].ocrText?.contains) {
        assert.equal(where.AND[0].OR[0].ocrText.contains, 'UMOWA');
        return [attachment('older-ocr', 'Treść skanu: umowa zawarta w 2024 r.', 'Inne dokumenty')];
      }
      return Array.from({ length: 10 }, (_, index) =>
        attachment(`newer-${index}`, null, 'Korespondencja - umowa klienta'));
    };
    const result = await searchService.search('tenant-a', 'UMOWA', { types: ['document'], limit: 10 }, 'Księgowość');
    assert.equal(result.results[0].id, 'older-ocr');
    assert.equal(result.total, 11);
  } finally {
    prisma.document.findMany = originalDocument;
    prisma.attachment.findMany = originalAttachment;
  }
});

test('ranks an older exact folder number ahead of newer partial matches within the department', async () => {
  const original = prisma.folder.findMany;
  try {
    const folder = (id, folderNumber) => ({
      id, folderNumber, title: 'Regulaminy', description: null, docType: null,
      status: 'active', boxId: null, box: null, custodyEvents: [], transferListItem: null,
    });
    prisma.folder.findMany = async ({ where, take }) => {
      assert.equal(where.tenantId, 'tenant-a');
      assert.deepEqual(where.box.is.department, { equals: 'Księgowość', mode: 'insensitive' });
      assert.equal(take, 11);
      if (where.OR[0].folderNumber?.equals) {
        assert.equal(where.OR[0].folderNumber.equals, 'SMG/1473');
        return [folder('exact-folder', 'SMG/1473')];
      }
      return Array.from({ length: 10 }, (_, index) => folder(`newer-${index}`, `SMG/14730${index}`));
    };
    const result = await searchService.search('tenant-a', 'SMG/1473', { types: ['folder'], limit: 10 }, 'Księgowość');
    assert.equal(result.results[0].id, 'exact-folder');
    assert.equal(result.total, 11);
  } finally {
    prisma.folder.findMany = original;
  }
});

test('ranks an older exact document title ahead of newer partial matches within the department', async () => {
  const originalDocument = prisma.document.findMany;
  const originalAttachment = prisma.attachment.findMany;
  try {
    const document = (id, title) => ({
      id, title, description: null, docType: null, docDate: null,
      folder: null, box: null, custodyEvents: [], attachments: [],
    });
    prisma.document.findMany = async ({ where, take }) => {
      assert.equal(where.tenantId, 'tenant-a');
      assert.equal(where.OR[0].folder.box.department.equals, 'Księgowość');
      assert.equal(where.OR[1].box.department.equals, 'Księgowość');
      assert.equal(take, 11);
      if (where.AND[0].OR[0].title.equals) {
        assert.equal(where.AND[0].OR[0].title.equals, 'Umowa dzierżawy 2024');
        return [document('exact-document', 'Umowa dzierżawy 2024')];
      }
      return Array.from({ length: 10 }, (_, index) => document(`newer-${index}`, `Umowa dzierżawy 2024 - kopia ${index}`));
    };
    prisma.attachment.findMany = async () => [];
    const result = await searchService.search('tenant-a', 'Umowa dzierżawy 2024', { types: ['document'], limit: 10 }, 'Księgowość');
    assert.equal(result.results[0].id, 'exact-document');
    assert.equal(result.total, 11);
  } finally {
    prisma.document.findMany = originalDocument;
    prisma.attachment.findMany = originalAttachment;
  }
});

test('deduplicates records found by both exact and partial searches', async () => {
  const original = prisma.folder.findMany;
  try {
    prisma.folder.findMany = async () => [{
      id: 'folder-1', folderNumber: 'SMG/1473', title: 'Regulaminy', description: null,
      docType: null, status: 'active', boxId: null, box: null, custodyEvents: [], transferListItem: null,
    }];
    const result = await searchService.search('tenant-a', 'SMG/1473', { types: ['folder'] });
    assert.equal(result.total, 1);
    assert.equal(result.results.length, 1);
  } finally {
    prisma.folder.findMany = original;
  }
});

test('shows the current box shelf for a folder, separately from its transfer-list box number', async () => {
  const original = prisma.folder.findMany;
  try {
    prisma.folder.findMany = async ({ where, include }) => {
      assert.equal(where.tenantId, 'tenant-a');
      assert.deepEqual(include.box.select.location.select, { fullPath: true });
      assert.equal(include.custodyEvents.take, 1);
      return [{
        id: 'folder-1', folderNumber: 'SMG/1473', title: 'Regulaminy', description: null,
        docType: null, status: 'active', boxId: 'box-1', custodyEvents: [],
        box: { boxNumber: 'K-2026-000731', status: 'active', deletedAt: null, location: { fullPath: 'Magazyn A / Regał 2 / Półka 3' } },
        transferListItem: {
          id: 'item-1', categoryCode: null, storageLocation: 'Dawna półka', sourceBoxNumber: 'SMG/K/1',
          transferList: { id: 'list-1', listNumber: 'SZO-2026-0003', title: 'Spis' },
        },
      }];
    };
    const { results } = await searchService.search('tenant-a', 'SMG/1473', { types: ['folder'] });
    assert.match(results[0].subtitle, /Karton: K-2026-000731/);
    assert.match(results[0].subtitle, /Karton w spisie: SMG\/K\/1/);
    assert.match(results[0].subtitle, /Lokalizacja: Magazyn A \/ Regał 2 \/ Półka 3/);
    assert.doesNotMatch(results[0].subtitle, /Dawna półka/);
  } finally {
    prisma.folder.findMany = original;
  }
});

test('does not present a box shelf as the current location of a handed-over folder', async () => {
  const original = prisma.folder.findMany;
  try {
    prisma.folder.findMany = async () => [{
      id: 'folder-1', folderNumber: 'SMG/1473', title: 'Regulaminy', description: null,
      docType: null, status: 'active', boxId: 'box-1',
      box: { boxNumber: 'K-2026-000731', status: 'active', deletedAt: null, location: { fullPath: 'Magazyn A / Półka 3' } },
      custodyEvents: [{ eventType: 'handover' }], transferListItem: null,
    }];
    const { results } = await searchService.search('tenant-a', 'SMG/1473', { types: ['folder'] });
    assert.match(results[0].subtitle, /Lokalizacja: Teczka wydana poza archiwum/);
    assert.doesNotMatch(results[0].subtitle, /Półka 3/);
  } finally {
    prisma.folder.findMany = original;
  }
});

test('does not use historical transfer-list storage as the current location of an unboxed folder', async () => {
  const original = prisma.folder.findMany;
  try {
    prisma.folder.findMany = async () => [{
      id: 'folder-1', folderNumber: 'SMG/1473', title: 'Regulaminy', description: null,
      docType: null, status: 'active', boxId: null, box: null, custodyEvents: [],
      transferListItem: {
        id: 'item-1', categoryCode: null, storageLocation: 'Dawna półka', sourceBoxNumber: 'SMG/K/1',
        transferList: { id: 'list-1', listNumber: 'SZO-2026-0003', title: 'Spis' },
      },
    }];
    const { results } = await searchService.search('tenant-a', 'SMG/1473', { types: ['folder'] });
    assert.match(results[0].subtitle, /Karton: —/);
    assert.match(results[0].subtitle, /Lokalizacja: Brak potwierdzonej lokalizacji/);
    assert.doesNotMatch(results[0].subtitle, /Dawna półka/);
  } finally {
    prisma.folder.findMany = original;
  }
});

test('uses the current box shelf after a folder return even if its status was not reset', async () => {
  const original = prisma.folder.findMany;
  try {
    prisma.folder.findMany = async () => [{
      id: 'folder-1', folderNumber: 'SMG/1473', title: 'Regulaminy', description: null,
      docType: null, status: 'checked_out', boxId: 'box-1',
      box: { boxNumber: 'K-2026-000731', status: 'active', deletedAt: null, location: { fullPath: 'Magazyn A / Półka 3' } },
      custodyEvents: [{ eventType: 'return_event' }], transferListItem: null,
    }];
    const { results } = await searchService.search('tenant-a', 'SMG/1473', { types: ['folder'] });
    assert.match(results[0].subtitle, /Lokalizacja: Magazyn A \/ Półka 3/);
  } finally {
    prisma.folder.findMany = original;
  }
});

test('does not claim a shelf for a checked-out box', async () => {
  const original = prisma.box.findMany;
  try {
    prisma.box.findMany = async () => [{
      id: 'box-1', boxNumber: 'K-2026-000731', title: 'Karton', status: 'checked_out', deletedAt: null,
      location: { fullPath: 'Magazyn A / Półka 3' },
    }];
    const { results } = await searchService.search('tenant-a', 'K-2026-000731', { types: ['box'] });
    assert.match(results[0].subtitle, /Lokalizacja: Karton wydany poza archiwum/);
    assert.doesNotMatch(results[0].subtitle, /Półka 3/);
  } finally {
    prisma.box.findMany = original;
  }
});

test('shows a document current shelf through its folder instead of a stale direct box', async () => {
  const originalDocument = prisma.document.findMany;
  const originalAttachment = prisma.attachment.findMany;
  try {
    prisma.document.findMany = async ({ include }) => {
      assert.equal(include.custodyEvents.take, 1);
      assert.equal(include.folder.select.custodyEvents.take, 1);
      return [{
        id: 'document-1', title: 'Umowa', description: null, docType: null, docDate: null,
        boxId: 'old-box', custodyEvents: [], attachments: [],
        box: { id: 'old-box', boxNumber: 'K-OLD', department: 'Księgowość', status: 'active', deletedAt: null, location: { fullPath: 'Dawna półka' } },
        folder: {
          folderNumber: 'SMG/1473', status: 'active', custodyEvents: [],
          box: { id: 'box-1', boxNumber: 'K-2026-000731', department: 'Księgowość', status: 'active', deletedAt: null, location: { fullPath: 'Magazyn A / Półka 3' } },
        },
      }];
    };
    prisma.attachment.findMany = async () => [];
    const { results } = await searchService.search('tenant-a', 'Umowa', { types: ['document'] });
    assert.match(results[0].subtitle, /Karton: K-2026-000731 \| Lokalizacja: Magazyn A \/ Półka 3/);
    assert.doesNotMatch(results[0].subtitle, /Dawna półka/);
    assert.equal(results[0].metadata.boxId, 'box-1');
  } finally {
    prisma.document.findMany = originalDocument;
    prisma.attachment.findMany = originalAttachment;
  }
});

test('does not claim a shelf for a handed-over document', async () => {
  const originalDocument = prisma.document.findMany;
  const originalAttachment = prisma.attachment.findMany;
  try {
    prisma.document.findMany = async () => [{
      id: 'document-1', title: 'Umowa', description: null, docType: null, docDate: null,
      custodyEvents: [{ eventType: 'handover' }], attachments: [], folder: null,
      box: { id: 'box-1', boxNumber: 'K-2026-000731', status: 'active', deletedAt: null, location: { fullPath: 'Magazyn A / Półka 3' } },
    }];
    prisma.attachment.findMany = async () => [];
    const { results } = await searchService.search('tenant-a', 'Umowa', { types: ['document'] });
    assert.match(results[0].subtitle, /Lokalizacja: Dokument wydany poza archiwum/);
    assert.doesNotMatch(results[0].subtitle, /Półka 3/);
  } finally {
    prisma.document.findMany = originalDocument;
    prisma.attachment.findMany = originalAttachment;
  }
});

test('locates a scan through its linked document and folder, not a stale direct box', async () => {
  const originalDocument = prisma.document.findMany;
  const originalAttachment = prisma.attachment.findMany;
  try {
    prisma.document.findMany = async () => [];
    prisma.attachment.findMany = async ({ include }) => {
      assert.equal(include.document.select.custodyEvents.take, 1);
      return [{
        id: 'attachment-1', fileName: 'skan.pdf', ocrText: null, mimeType: 'application/pdf',
        box: { id: 'old-box', boxNumber: 'K-OLD', title: 'Stary karton', location: { fullPath: 'Dawna półka' } },
        folder: null,
        document: {
          id: 'document-1', title: 'Umowa', custodyEvents: [], box: null,
          folder: {
            status: 'active', custodyEvents: [],
            box: { id: 'box-1', boxNumber: 'K-2026-000731', status: 'active', deletedAt: null, location: { fullPath: 'Magazyn A / Półka 3' } },
          },
        },
      }];
    };
    const { results } = await searchService.search('tenant-a', 'skan.pdf', { types: ['document'] });
    assert.match(results[0].subtitle, /Karton: K-2026-000731 \| Lokalizacja: Magazyn A \/ Półka 3/);
    assert.doesNotMatch(results[0].subtitle, /Dawna półka/);
    assert.equal(results[0].metadata.boxId, 'box-1');
  } finally {
    prisma.document.findMany = originalDocument;
    prisma.attachment.findMany = originalAttachment;
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
    assert.deepEqual(result, { results: [], total: 0, hasMore: false });
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
