import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { prisma } = require('../dist/config/database.js');
const { boxService } = require('../dist/modules/boxes/box.service.js');
const { TransferListService } = require('../dist/modules/transfer-lists/transfer-list.service.js');
const { effectiveStorageLocation } = require('../dist/modules/transfer-lists/storage-location.js');

test('a boxed folder always follows its box, including after a move', () => {
  const item = { boxId: 'box-1', storageLocation: 'Stara półka', box: { location: { fullPath: 'Magazyn > Półka 1' } } };
  assert.equal(effectiveStorageLocation(item), 'Magazyn > Półka 1');
  item.box.location.fullPath = 'Magazyn > Półka 2';
  assert.equal(effectiveStorageLocation(item), 'Magazyn > Półka 2');
  assert.equal(effectiveStorageLocation({ ...item, box: { location: null } }), null);
  assert.equal(effectiveStorageLocation({ ...item, boxId: null }), 'Stara półka');
});

test('transfer-list API rows expose the box location instead of stale imported text', async () => {
  const service = new TransferListService();
  const originalFindMany = prisma.transferListItem.findMany;
  const originalCount = prisma.transferListItem.count;
  prisma.transferListItem.findMany = async () => [
    { id: 'item-1', boxId: 'box-1', storageLocation: 'Stara półka', box: { location: { fullPath: 'Nowa półka' } } },
    { id: 'item-2', boxId: null, storageLocation: 'Miejsce z importu', box: null },
  ];
  prisma.transferListItem.count = async () => 2;
  const getList = mock.method(service, 'getById', async () => ({ status: 'draft' }));
  try {
    const result = await service.getItems('list-1', 'tenant-1', {}, 0, 50);
    assert.deepEqual(result.data.map((item) => item.storageLocation), ['Nowa półka', 'Miejsce z importu']);
  } finally {
    getList.mock.restore();
    prisma.transferListItem.findMany = originalFindMany;
    prisma.transferListItem.count = originalCount;
  }
});

test('bulk location change moves one box for all selected folders', async () => {
  const service = new TransferListService();
  const calls = [];
  const originalFindMany = prisma.transferListItem.findMany;
  prisma.transferListItem.findMany = async () => [
    { id: 'item-1', boxId: 'box-1' },
    { id: 'item-2', boxId: 'box-1' },
  ];
  const mocks = [
    mock.method(service, 'getById', async () => ({ status: 'draft' })),
    mock.method(boxService, 'bulkMove', async (...args) => { calls.push(args); return { updated: 1, moved: 1 }; }),
  ];
  try {
    const result = await service.bulkUpdateStorageLocation('list-1', 'tenant-1', 'user-1', ['item-1', 'item-2'], 'shelf-1');
    assert.deepEqual(result, { updated: 2, movedBoxes: 1 });
    assert.deepEqual(calls, [[['box-1'], 'tenant-1', 'shelf-1', 'user-1']]);
  } finally {
    mocks.reverse().forEach((entry) => entry.mock.restore());
    prisma.transferListItem.findMany = originalFindMany;
  }
});

test('bulk location change refuses folders without a box', async () => {
  const service = new TransferListService();
  const originalFindMany = prisma.transferListItem.findMany;
  prisma.transferListItem.findMany = async () => [{ id: 'item-1', boxId: null }];
  const mocks = [
    mock.method(service, 'getById', async () => ({ status: 'draft' })),
    mock.method(boxService, 'bulkMove', async () => { throw new Error('box movement must not run'); }),
  ];
  try {
    await assert.rejects(
      service.bulkUpdateStorageLocation('list-1', 'tenant-1', 'user-1', ['item-1'], 'shelf-1'),
      /Najpierw przypisz karton/,
    );
  } finally {
    mocks.reverse().forEach((entry) => entry.mock.restore());
    prisma.transferListItem.findMany = originalFindMany;
  }
});
