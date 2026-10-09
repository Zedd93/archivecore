import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { sortWarehouseTasks } = require('../../client/src/utils/warehouseTasks.ts');

function task(id, slaDeadline, priority, createdAt = '2026-10-09T09:00:00Z') {
  return { id, orderNumber: id, orderType: 'checkout', status: 'approved', priority, slaDeadline, createdAt };
}

test('warehouse worklist puts nearest deadlines ahead of priority, then urgent work first', () => {
  const tasks = [
    task('undated', null, 'urgent'),
    task('later', '2026-10-10T09:00:00Z', 'urgent'),
    task('soon-normal', '2026-10-09T10:00:00Z', 'normal'),
    task('soon-urgent', '2026-10-09T10:00:00Z', 'urgent'),
  ];
  assert.deepEqual(sortWarehouseTasks(tasks).map((item) => item.id), [
    'soon-urgent', 'soon-normal', 'later', 'undated',
  ]);
  assert.equal(tasks[0].id, 'undated');
});

test('tasks without a valid deadline are ordered by priority and recency', () => {
  const tasks = [
    task('older', null, 'normal', '2026-10-08T09:00:00Z'),
    task('newer', null, 'normal', '2026-10-09T09:00:00Z'),
    task('invalid', 'not-a-date', 'high'),
  ];
  assert.deepEqual(sortWarehouseTasks(tasks).map((item) => item.id), ['invalid', 'newer', 'older']);
});
