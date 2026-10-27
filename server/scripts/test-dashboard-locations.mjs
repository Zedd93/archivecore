import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { summarizeDashboardLocations } = require('../src/modules/reports/dashboard-locations.ts');

test('counts warehouses without slots and uses their configured capacities', () => {
  const locations = [
    { id: 'a', parentId: null, capacity: 10 },
    { id: 'b', parentId: null, capacity: 20 },
    { id: 'c', parentId: null, capacity: 30 },
  ];
  assert.deepEqual(summarizeDashboardLocations(locations, new Map([['a', 3], ['c', 12]])), {
    totalLocations: 3,
    occupancyRate: 25,
  });
});

test('counts nested boxes once and does not add child capacities to a parent capacity', () => {
  const locations = [
    { id: 'warehouse', parentId: null, capacity: 10 },
    { id: 'shelf', parentId: 'warehouse', capacity: 5 },
    { id: 'slot', parentId: 'shelf', capacity: 2 },
  ];
  assert.deepEqual(summarizeDashboardLocations(locations, new Map([['warehouse', 1], ['slot', 4]])), {
    totalLocations: 3,
    occupancyRate: 50,
  });
});

test('uses branch capacities when the warehouse has no capacity of its own', () => {
  const locations = [
    { id: 'warehouse', parentId: null, capacity: null },
    { id: 'a', parentId: 'warehouse', capacity: 5 },
    { id: 'b', parentId: 'warehouse', capacity: 5 },
  ];
  assert.equal(summarizeDashboardLocations(locations, new Map([['a', 2], ['b', 3]])).occupancyRate, 50);
});

test('does not present unknown or zero capacity as zero percent occupancy', () => {
  assert.equal(summarizeDashboardLocations([{ id: 'warehouse', parentId: null, capacity: null }], new Map([['warehouse', 2]])).occupancyRate, null);
  assert.equal(summarizeDashboardLocations([{ id: 'warehouse', parentId: null, capacity: 0 }], new Map()).occupancyRate, null);
  assert.equal(summarizeDashboardLocations([], new Map()).occupancyRate, null);
});
