const test = require('node:test');
const assert = require('node:assert/strict');
const { mock } = require('node:test');
const { prisma } = require('../dist/config/database');
const { FolderService } = require('../dist/modules/folders/folder.service');
const { TransferListService } = require('../dist/modules/transfer-lists/transfer-list.service');

function replace(delegate, method, implementation) {
  const original = delegate[method];
  delegate[method] = implementation;
  return () => { delegate[method] = original; };
}

test('folder list filters explicit missing dates within tenant and department', async () => {
  const queries = [];
  const restoreFindMany = replace(prisma.folder, 'findMany', async (args) => {
    queries.push(args.where);
    return [{
      id: 'folder-1', title: 'Akta', folderNumber: 'A/1', dateFrom: null, dateTo: null,
      box: null, transferListItem: {
        id: 'item-1', dateRangeUnknown: true, categoryCode: 'B50',
        transferList: { id: 'list-1', listNumber: 'SZO-1' },
      },
      _count: { documents: 0, attachments: 0 },
    }];
  });
  const restoreCount = replace(prisma.folder, 'count', async (args) => {
    queries.push(args.where);
    return 1;
  });
  try {
    const result = await new FolderService().listAll('tenant-1', { dates: 'unknown', source: 'transfer_list' }, 0, 50, 'Księgowość');
    assert.equal(result.total, 1);
    assert.equal(result.data[0].dateRangeUnknown, true);
    for (const where of queries) {
      assert.equal(where.tenantId, 'tenant-1');
      assert.deepEqual(where.transferListItem, { isNot: null });
      assert.deepEqual(where.AND, [{ transferListItem: { is: { dateRangeUnknown: true } } }]);
      assert.deepEqual(where.box.is.department, { equals: 'Księgowość', mode: 'insensitive' });
    }
  } finally {
    restoreFindMany();
    restoreCount();
  }
});

test('folder list does not treat every empty date range as explicitly unknown', async () => {
  let where;
  const restoreFindMany = replace(prisma.folder, 'findMany', async (args) => { where = args.where; return []; });
  const restoreCount = replace(prisma.folder, 'count', async () => 0);
  try {
    await new FolderService().listAll('tenant-1', {}, 0, 50);
    assert.equal(where.AND, undefined);
    assert.equal(where.tenantId, 'tenant-1');
  } finally {
    restoreFindMany();
    restoreCount();
  }
});

test('transfer list date filter combines with list and search filters', async () => {
  let where;
  const service = new TransferListService();
  const getById = mock.method(service, 'getById', async (listId, tenantId) => {
    assert.equal(listId, 'list-1');
    assert.equal(tenantId, 'tenant-1');
    return { id: listId, tenantId };
  });
  const restoreFindMany = replace(prisma.transferListItem, 'findMany', async (args) => { where = args.where; return []; });
  const restoreCount = replace(prisma.transferListItem, 'count', async (args) => {
    assert.deepEqual(args.where, where);
    return 0;
  });
  try {
    const result = await service.getItems('list-1', 'tenant-1', { dates: 'unknown', search: 'Akta' }, 0, 50);
    assert.equal(result.total, 0);
    assert.equal(where.transferListId, 'list-1');
    assert.equal(where.dateRangeUnknown, true);
    assert.ok(where.OR.some((part) => part.folderTitle?.contains === 'Akta'));
  } finally {
    getById.mock.restore();
    restoreFindMany();
    restoreCount();
  }
});
