import assert from 'node:assert/strict';
import test from 'node:test';
import requesterAccess from '../src/modules/orders/order-requester-access.ts';

const { assertDepartmentRequesterAction } = requesterAccess;

test('department employee may submit and change only their own draft', () => {
  const draft = { requestedBy: 'user-a', status: 'draft' };
  assert.doesNotThrow(() => assertDepartmentRequesterAction(draft, 'user-a', 'submit'));
  assert.doesNotThrow(() => assertDepartmentRequesterAction(draft, 'user-a', 'addItem'));
  assert.throws(() => assertDepartmentRequesterAction(draft, 'user-b', 'submit'), { statusCode: 403 });
  assert.throws(() => assertDepartmentRequesterAction(draft, 'user-b', 'addItem'), { statusCode: 403 });
  assert.throws(() => assertDepartmentRequesterAction(draft, 'user-b', 'cancel'), { statusCode: 403 });
});

test('department employee cannot change submitted items or cancel approved orders', () => {
  const submitted = { requestedBy: 'user-a', status: 'submitted' };
  assert.throws(() => assertDepartmentRequesterAction(submitted, 'user-a', 'addItem'), { statusCode: 403 });
  assert.doesNotThrow(() => assertDepartmentRequesterAction(submitted, 'user-a', 'cancel'));
  assert.throws(() => assertDepartmentRequesterAction({ ...submitted, status: 'approved' }, 'user-a', 'cancel'), { statusCode: 403 });
});
