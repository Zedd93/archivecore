import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { sortWarehouseTasks } = require('../../client/src/utils/warehouseTasks.ts');
const { prisma } = require('../dist/config/database.js');
const { OrderService } = require('../dist/modules/orders/order.service.js');

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

test('warehouse query selects the earliest SLA tasks across all active statuses and respects department access', async () => {
  const originalFindMany = prisma.order.findMany;
  const originalCount = prisma.order.count;
  let query;
  let countWhere;
  prisma.order.findMany = async (args) => {
    query = args;
    return [task('old-overdue', '2026-10-01T09:00:00Z', 'normal')];
  };
  prisma.order.count = async ({ where }) => {
    countWhere = where;
    return 25;
  };
  try {
    const result = await new OrderService().listWarehouseTasks('tenant-a', 'Księgowość');
    assert.deepEqual(result.data.map((item) => item.id), ['old-overdue']);
    assert.equal(result.total, 25);
    assert.equal(query.take, 12);
    assert.deepEqual(query.orderBy, [
      { slaDeadline: { sort: 'asc', nulls: 'last' } },
      { priority: 'desc' },
      { createdAt: 'desc' },
    ]);
    assert.deepEqual(query.where.status.in, ['approved', 'in_progress', 'ready']);
    assert.equal(query.where.tenantId, 'tenant-a');
    assert.equal(query.where.AND[0].OR[0].orderType.not, 'scan');
    assert.deepEqual(countWhere, query.where);
  } finally {
    prisma.order.findMany = originalFindMany;
    prisma.order.count = originalCount;
  }
});
