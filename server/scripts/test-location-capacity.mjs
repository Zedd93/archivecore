import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { findAvailableLocations } = require('../src/modules/locations/location-capacity.ts');

const location = (id, parentId, type, capacity, tenantId = 'tenant-a', isActive = true) => ({
  id, parentId, type, capacity, tenantId, isActive,
  code: id, name: id, fullPath: id,
});

test('respects both destination and ancestor limits using descendant occupancy', () => {
  const locations = [
    location('warehouse', null, 'warehouse', 4),
    location('rack', 'warehouse', 'rack', null),
    location('shelf-a', 'rack', 'shelf', 10),
    location('shelf-b', 'rack', 'shelf', 10),
  ];
  const result = findAvailableLocations(locations, new Map([['shelf-a', 2], ['shelf-b', 1]]), 'tenant-a');
  assert.deepEqual(result.map((item) => [item.id, item.available]), [['shelf-a', 1], ['shelf-b', 1]]);
});

test('includes levels and slots but not full, unknown-capacity or foreign locations', () => {
  const locations = [
    location('shelf', null, 'shelf', 2),
    location('level', 'shelf', 'level', 3),
    location('slot', 'level', 'slot', 1),
    location('full', null, 'shelf', 1),
    location('unknown', null, 'shelf', null),
    location('foreign', null, 'shelf', 10, 'tenant-b'),
    location('inactive', null, 'shelf', 10, 'tenant-a', false),
  ];
  const result = findAvailableLocations(locations, new Map([['slot', 1], ['full', 1]]), 'tenant-a');
  assert.deepEqual(result.map((item) => [item.id, item.available]), [['level', 1], ['shelf', 1]]);
});

test('does not recommend a child of a full or inactive parent', () => {
  const locations = [
    location('full-parent', null, 'rack', 1),
    location('child', 'full-parent', 'shelf', 10),
    location('inactive-parent', null, 'rack', 10, 'tenant-a', false),
    location('inactive-child', 'inactive-parent', 'shelf', 10),
  ];
  assert.deepEqual(findAvailableLocations(locations, new Map([['child', 1]]), 'tenant-a'), []);
});
