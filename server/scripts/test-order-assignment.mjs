import assert from 'node:assert/strict';
import test from 'node:test';
import assignmentModule from '../src/modules/orders/order-assignment.ts';
import orderModule from '../src/modules/orders/order.service.ts';
import databaseModule from '../src/config/database.ts';

const { PROCESSING_ROLE_CODES, canAssignOrder } = assignmentModule;
const { OrderService } = orderModule;
const { prisma } = databaseModule;

test('only roles with order processing permission can be assigned', () => {
  assert.ok(PROCESSING_ROLE_CODES.includes('OM'));
  assert.ok(PROCESSING_ROLE_CODES.includes('TL'));
  assert.ok(PROCESSING_ROLE_CODES.includes('DA'));
  assert.ok(!PROCESSING_ROLE_CODES.includes('TE'));
  assert.ok(!PROCESSING_ROLE_CODES.includes('KK'));
});

test('delivered and terminal orders cannot be reassigned', () => {
  for (const status of ['delivered', 'completed', 'rejected', 'cancelled']) {
    assert.equal(canAssignOrder(status), false);
  }
  for (const status of ['draft', 'submitted', 'approved', 'in_progress', 'ready']) {
    assert.equal(canAssignOrder(status), true);
  }
});

test('starting work preserves a manually assigned handler', () => {
  const service = new OrderService();
  const assigned = service.getStatusUpdateData({ assignedTo: 'selected-user', notes: null }, 'in_progress', 'actor');
  assert.equal(assigned.assignee, undefined);
  const unassigned = service.getStatusUpdateData({ assignedTo: null, notes: null }, 'in_progress', 'actor');
  assert.deepEqual(unassigned.assignee, { connect: { id: 'actor' } });
});

test('department employee cannot assign an order outside the assigned department', async () => {
  const originalFindFirst = prisma.order.findFirst;
  let query;
  prisma.order.findFirst = async (input) => { query = input; return null; };
  try {
    await assert.rejects(
      new OrderService().assign('order-1', 'tenant-a', 'worker-1', 'actor-1', 'Księgowość'),
      (error) => error.statusCode === 404,
    );
    assert.equal(query.where.tenantId, 'tenant-a');
    assert.equal(query.where.AND[0].AND[1].items.every.OR[0].box.department.equals, 'Księgowość');
  } finally {
    prisma.order.findFirst = originalFindFirst;
  }
});

test('assignment write retains tenant and department scope', async () => {
  const originalFindFirst = prisma.order.findFirst;
  const originalTransaction = prisma.$transaction;
  let updateWhere;
  let notification;
  prisma.order.findFirst = async () => ({ id: 'order-1', orderNumber: 'Z-1', status: 'submitted' });
  prisma.$transaction = async (callback) => callback({
    user: {
      findFirst: async () => ({ id: 'worker-1' }),
      findMany: async () => [{ id: 'worker-1', userRoles: [{ role: { code: 'OM' } }] }],
    },
    order: {
      findFirst: async ({ where }) => {
        assert.equal(where.AND[0].AND[1].items.every.OR[0].box.department.equals, 'Księgowość');
        return { assignedTo: null, status: 'submitted' };
      },
      updateMany: async ({ where }) => { updateWhere = where; return { count: 1 }; },
      findUniqueOrThrow: async () => ({ id: 'order-1', assignedTo: 'worker-1' }),
    },
    notification: {
      createMany: async ({ data }) => { notification = data; return { count: data.length }; },
    },
  });
  try {
    const result = await new OrderService().assign('order-1', 'tenant-a', 'worker-1', 'actor-1', 'Księgowość');
    assert.equal(updateWhere.tenantId, 'tenant-a');
    assert.equal(updateWhere.AND[0].AND[1].items.every.OR[0].box.department.equals, 'Księgowość');
    assert.equal(updateWhere.assignedTo, null);
    assert.equal(result.assignedTo, 'worker-1');
    assert.deepEqual(notification.map((entry) => entry.userId), ['worker-1']);
  } finally {
    prisma.order.findFirst = originalFindFirst;
    prisma.$transaction = originalTransaction;
  }
});
