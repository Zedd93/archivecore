import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { expectedInventoryBoxes } = require('../dist/modules/inventory/inventory.service.js');
const { escapeInventoryCsvCell, reconcileInventory } = require('../../client/src/utils/inventory.ts');

test('whole-box checkout is excluded, while a box with only a folder loan stays expected', () => {
  const boxes = [
    { id: 'whole-loan', status: 'checked_out' },
    { id: 'folder-loan', status: 'checked_out' },
    { id: 'lost', status: 'lost' },
    { id: 'active', status: 'active' },
  ];
  const expected = expectedInventoryBoxes(boxes, new Set(['whole-loan']));
  assert.deepEqual(expected.map((box) => box.id), ['folder-loan', 'active']);
});

test('inventory reconciliation separates missing, misplaced and unexpected boxes', () => {
  const box = (id, locationId) => ({ id, locationId });
  const expected = [box('matched', 'shelf-a'), box('missing', 'shelf-a')];
  const scanned = [box('matched', 'shelf-a'), box('misplaced', 'shelf-b'), box('unexpected', 'shelf-a')];
  const result = reconcileInventory('shelf-a', expected, scanned);
  assert.deepEqual(result.matched.map((item) => item.id), ['matched']);
  assert.deepEqual(result.missing.map((item) => item.id), ['missing']);
  assert.deepEqual(result.wrongLocation.map((item) => item.id), ['misplaced']);
  assert.deepEqual(result.unexpected.map((item) => item.id), ['unexpected']);
});

test('a box moved in the records after the snapshot is not counted as matched', () => {
  const expected = [{ id: 'moved', locationId: 'shelf-a' }];
  const scanned = [{ id: 'moved', locationId: 'shelf-b' }];
  const result = reconcileInventory('shelf-a', expected, scanned);
  assert.equal(result.matched.length, 0);
  assert.equal(result.missing.length, 0);
  assert.deepEqual(result.wrongLocation, scanned);
});

test('CSV cells escape quotes, delimiters and spreadsheet formulas', () => {
  assert.equal(escapeInventoryCsvCell('A; "B"'), '"A; ""B"""');
  assert.equal(escapeInventoryCsvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
});
