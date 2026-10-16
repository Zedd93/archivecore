import assert from 'node:assert/strict';
import test from 'node:test';
import { notificationNavigation } from '../src/utils/notificationNavigation.ts';

test('global staff switch to the notification tenant before opening an order', () => {
  assert.deepEqual(notificationNavigation('/orders/order-a', 'tenant-a', 'tenant-b', true), {
    path: '/orders/order-a', switchToTenantId: 'tenant-a',
  });
});

test('tenant users and matching global context keep their selected tenant', () => {
  assert.equal(notificationNavigation('/orders/order-a', 'tenant-a', 'tenant-b', false).switchToTenantId, null);
  assert.equal(notificationNavigation('/orders/order-a', 'tenant-a', 'tenant-a', true).switchToTenantId, null);
  assert.equal(notificationNavigation('/orders/order-a', null, 'tenant-b', true).switchToTenantId, null);
});

test('notifications cannot navigate to an external origin', () => {
  assert.equal(notificationNavigation('https://example.com', 'tenant-a', null, true), null);
  assert.equal(notificationNavigation('//example.com', 'tenant-a', null, true), null);
});
