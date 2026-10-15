import assert from 'node:assert/strict';
import test from 'node:test';
import assignmentModule from '../src/modules/orders/order-assignment.ts';
import orderModule from '../src/modules/orders/order.service.ts';

const { PROCESSING_ROLE_CODES, canAssignOrder } = assignmentModule;
const { OrderService } = orderModule;

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
