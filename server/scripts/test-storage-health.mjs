import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { findOverCapacityLocations } = require('../src/modules/reports/storage-health.ts');
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

test('archive health checks use the selected tenant and return actionable samples', async () => {
  const originalQueryRaw = prisma.$queryRaw;
  const originalFindMany = prisma.location.findMany;
  const originalGroupBy = prisma.box.groupBy;
  const queryTenants = [];
  let queryIndex = 0;
  let locationsWhere;
  let countsWhere;
  prisma.$queryRaw = async (_strings, tenantId) => {
    queryTenants.push(tenantId);
    queryIndex++;
    if (queryIndex === 1) return [{ id: 'box-a', boxNumber: 'K-1', total: 2 }];
    if (queryIndex === 2) return [{ id: 'box-b', boxNumber: 'K-2', total: 1 }];
    return [{ id: 'folder-a', folderNumber: 'T-1', total: 1 }];
  };
  prisma.location.findMany = async ({ where }) => {
    locationsWhere = where;
    return [{ id: 'shelf', parentId: null, fullPath: 'Magazyn > Półka', capacity: 1, isActive: true }];
  };
  prisma.box.groupBy = async ({ where }) => {
    countsWhere = where;
    return [{ locationId: 'shelf', _count: { _all: 2 } }];
  };
  try {
    const result = await new ReportService().getStorageHealth('tenant-a');
    assert.deepEqual(queryTenants, ['tenant-a', 'tenant-a', 'tenant-a']);
    assert.deepEqual(locationsWhere, { tenantId: 'tenant-a' });
    assert.deepEqual(countsWhere.locationId.in, ['shelf']);
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
