import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { findOverCapacityLocations, findTenantOverCapacityLocations } = require('../src/modules/reports/storage-health.ts');
const { prisma } = require('../dist/config/database.js');
const { ReportService } = require('../dist/modules/reports/report.service.js');

test('capacity check includes boxes in descendants and ignores unlimited locations', () => {
  const locations = [
    { id: 'warehouse', parentId: null, fullPath: 'Magazyn', capacity: 2, isActive: true },
    { id: 'rack', parentId: 'warehouse', fullPath: 'Magazyn > Regał', capacity: null, isActive: true },
    { id: 'shelf', parentId: 'rack', fullPath: 'Magazyn > Regał > Półka', capacity: 2, isActive: true },
  ];
  const directCounts = new Map([['shelf', 3]]);

  assert.deepEqual(findOverCapacityLocations(locations, directCounts), [
    { id: 'warehouse', fullPath: 'Magazyn', capacity: 2, occupied: 3 },
    { id: 'shelf', fullPath: 'Magazyn > Regał > Półka', capacity: 2, occupied: 3 },
  ]);
});

test('a location exactly at capacity is not reported', () => {
  const locations = [{ id: 'shelf', parentId: null, fullPath: 'Półka', capacity: 2, isActive: true }];
  assert.deepEqual(findOverCapacityLocations(locations, new Map([['shelf', 2]])), []);
});

test('shared-capacity audit includes physical occupancy without exposing other tenants locations', () => {
  const locations = [
    { id: 'warehouse', parentId: null, tenantId: null, fullPath: 'Magazyn', capacity: 3, isActive: true },
    { id: 'own', parentId: 'warehouse', tenantId: 'tenant-a', fullPath: 'Magazyn > Nasza polka', capacity: 1, isActive: true },
    { id: 'foreign', parentId: 'warehouse', tenantId: 'tenant-b', fullPath: 'Magazyn > Obca polka', capacity: 1, isActive: true },
    { id: 'shared-other', parentId: 'warehouse', tenantId: null, fullPath: 'Magazyn > Wspoldzielona', capacity: 1, isActive: true },
  ];
  const result = findTenantOverCapacityLocations(
    locations,
    new Map([['own', 2], ['foreign', 2], ['shared-other', 2]]),
    new Map([['own', 2]]),
    'tenant-a',
  );
  assert.deepEqual(result.map(({ id }) => id), ['warehouse', 'own']);
  assert.equal(result[0].occupied, 6);
});

test('overfull shared shelf is reported when the selected tenant stores a box there', () => {
  const locations = [{ id: 'shared', parentId: null, tenantId: null, fullPath: 'Polka wspoldzielona', capacity: 2, isActive: true }];
  const result = findTenantOverCapacityLocations(locations, new Map([['shared', 3]]), new Map([['shared', 1]]), 'tenant-a');
  assert.deepEqual(result.map(({ id, occupied }) => [id, occupied]), [['shared', 3]]);
});

test('archive health checks use the selected tenant and return actionable samples', async () => {
  const originalQueryRaw = prisma.$queryRaw;
  const originalFindMany = prisma.location.findMany;
  const originalGroupBy = prisma.box.groupBy;
  const queryTenants = [];
  let queryIndex = 0;
  let locationsQuery;
  const countQueries = [];
  prisma.$queryRaw = async (strings, tenantId) => {
    queryTenants.push(tenantId);
    queryIndex++;
    if (queryIndex === 1) {
      assert.match(String(strings), /pending_disposal/);
      assert.match(String(strings), /approved_disposal/);
      assert.match(String(strings), /damaged/);
    }
    if (queryIndex === 2) assert.match(String(strings), /WITH RECURSIVE ancestors/);
    if (queryIndex === 3) assert.match(String(strings), /LEFT JOIN "transfer_lists" list/);
    if (queryIndex === 1) return [{ id: 'box-a', boxNumber: 'K-1', total: 2 }];
    if (queryIndex === 2) return [{ id: 'box-b', boxNumber: 'K-2', total: 1 }];
    return [{ id: 'folder-a', folderNumber: 'T-1', total: 1 }];
  };
  prisma.location.findMany = async (query) => {
    locationsQuery = query;
    return [{ id: 'shelf', parentId: null, tenantId: 'tenant-a', fullPath: 'Magazyn > Półka', capacity: 1, isActive: true }];
  };
  prisma.box.groupBy = async ({ where }) => {
    countQueries.push(where);
    return [{ locationId: 'shelf', _count: { _all: 2 } }];
  };
  try {
    const result = await new ReportService().getStorageHealth('tenant-a');
    assert.deepEqual(queryTenants, ['tenant-a', 'tenant-a', 'tenant-a']);
    assert.equal(locationsQuery.where, undefined);
    assert.equal(countQueries.length, 2);
    assert.deepEqual(countQueries[0].locationId.in, ['shelf']);
    assert.equal(countQueries[0].tenantId, undefined);
    assert.equal(countQueries[1].tenantId, 'tenant-a');
    assert.equal(result.unlocated.total, 2);
    assert.deepEqual(result.unlocated.boxes, [{ id: 'box-a', boxNumber: 'K-1' }]);
    assert.equal(result.overCapacity.total, 1);
    assert.equal(result.overCapacity.locations[0].occupied, 2);
    assert.equal(result.tenantMismatch.total, 2);
    assert.deepEqual(result.tenantMismatch.folders, [{ id: 'folder-a', folderNumber: 'T-1' }]);
  } finally {
    prisma.$queryRaw = originalQueryRaw;
    prisma.location.findMany = originalFindMany;
    prisma.box.groupBy = originalGroupBy;
  }
});
