import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { findAvailableLocations } = require('../src/modules/locations/location-capacity.ts');
const { prisma } = require('../dist/config/database.js');
const { locationService } = require('../dist/modules/locations/location.service.js');

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

test('a move within a full warehouse reuses capacity already occupied by selected boxes', () => {
  const locations = [
    location('warehouse', null, 'warehouse', 3),
    location('rack', 'warehouse', 'rack', null),
    location('source', 'rack', 'shelf', 3),
    location('destination', 'rack', 'shelf', 2),
  ];
  const counts = new Map([['source', 3]]);
  assert.deepEqual(findAvailableLocations(locations, counts, 'tenant-a'), []);
  const result = findAvailableLocations(locations, counts, 'tenant-a', ['source', 'source']);
  assert.deepEqual(result.map(({ id, available }) => [id, available]), [['destination', 2], ['source', 2]]);
});

test('destination must fit the whole batch and a foreign ancestor is never suggested', () => {
  const locations = [
    location('warehouse', null, 'warehouse', 3),
    location('source', 'warehouse', 'shelf', 3),
    location('small', 'warehouse', 'shelf', 1),
    location('foreign-warehouse', null, 'warehouse', 10, 'tenant-b'),
    location('shared-child', 'foreign-warehouse', 'shelf', 10, null),
  ];
  const result = findAvailableLocations(locations, new Map([['source', 3]]), 'tenant-a', ['source', 'source']);
  assert.equal(result.find((item) => item.id === 'small')?.available, 1);
  assert.equal(result.some((item) => item.id === 'shared-child'), false);
  assert.equal(result.filter((item) => item.available >= 2).some((item) => item.id === 'small'), false);
});

test('capacity suggestions reject boxes outside the selected tenant or department', async () => {
  const originals = { locations: prisma.location.findMany, counts: prisma.box.groupBy, boxes: prisma.box.findMany };
  const boxId = 'a07ca020-f00e-485c-9d01-f9ed697e2f40';
  let visible = false;
  prisma.location.findMany = async () => [location('shelf', null, 'shelf', 2)];
  prisma.box.groupBy = async () => [];
  prisma.box.findMany = async ({ where }) => {
    assert.equal(where.tenantId, 'tenant-a');
    assert.equal(where.department.equals, 'Finanse');
    return visible ? [{ id: boxId, locationId: null }] : [];
  };
  try {
    await assert.rejects(locationService.getAvailableSlots('tenant-a', [boxId], 'Finanse'), { statusCode: 404 });
    visible = true;
    const result = await locationService.getAvailableSlots('tenant-a', [boxId], 'Finanse');
    assert.deepEqual(result.map(({ id, available }) => [id, available]), [['shelf', 2]]);
  } finally {
    prisma.location.findMany = originals.locations;
    prisma.box.groupBy = originals.counts;
    prisma.box.findMany = originals.boxes;
  }
});
