import assert from 'node:assert/strict';
import test from 'node:test';
const { SlaTargetAlertService } = await import('../src/modules/reports/sla-target-alert.service.ts');
const { NotificationService, notificationService } = await import('../src/modules/notifications/notification.service.ts');

test('SLA target alert reaches only managers of that client and global admins', async () => {
  let written;
  const db = {
    user: {
      findMany: async ({ where }) => {
        assert.equal(where.isActive, true);
        assert.deepEqual(where.OR, [{ tenantId: 'tenant-a' }, { tenantId: null }]);
        return [
          { id: 'client-lead', userRoles: [{ role: { code: 'TL' } }] },
          { id: 'client-admin', userRoles: [{ role: { code: 'AT' } }] },
          { id: 'global-admin', userRoles: [{ role: { code: 'DA' } }] },
          { id: 'client-employee', userRoles: [{ role: { code: 'TE' } }] },
        ];
      },
    },
    notification: {
      createMany: async ({ data }) => { written = data; return { count: data.length }; },
    },
  };
  const result = await new NotificationService().notifyTenantUsers({
    tenantId: 'tenant-a', type: 'tenant_sla_target_below', title: 'SLA', message: '80%',
    requiredRoleCodes: ['SA', 'DA', 'TL', 'AT'],
  }, db);
  assert.equal(result.count, 3);
  assert.deepEqual(written.map(({ userId }) => userId), ['client-lead', 'client-admin', 'global-admin']);
  assert.ok(written.every(({ tenantId }) => tenantId === 'tenant-a'));
});

test('SLA target alert is sent once per breach and rearms after recovery or insufficient data', async () => {
  const now = new Date('2026-10-16T12:00:00.000Z');
  const states = new Map();
  let counts = [
    { tenantId: 'tenant-a', completed: 5, breached: 1 },
    { tenantId: 'tenant-b', completed: 5, breached: 0 },
  ];
  let recipients = 1;
  const notifications = [];
  const originalNotify = notificationService.notifyTenantUsers;
  const alertState = {
    upsert: async ({ where }) => {
      if (!states.has(where.tenantId)) states.set(where.tenantId, { isBelow: false, lastNotifiedAt: null });
      return states.get(where.tenantId);
    },
    updateMany: async ({ where, data }) => {
      const state = states.get(where.tenantId);
      if (!state || state.isBelow !== where.isBelow) return { count: 0 };
      states.set(where.tenantId, { ...state, ...data });
      return { count: 1 };
    },
  };
  const db = {
    tenant: {
      findMany: async ({ where, select }) => {
        assert.deepEqual(where, { isActive: true });
        assert.equal(select.slaTargetPercent, true);
        return [
          { id: 'tenant-a', name: 'Firma A', slaTargetPercent: 95 },
          { id: 'tenant-b', name: 'Firma B', slaTargetPercent: 90 },
        ];
      },
    },
    $queryRaw: async (query) => {
      assert.match(query.sql, /"status" = 'completed'/);
      assert.match(query.sql, /"slaDeadline" IS NOT NULL/);
      assert.match(query.sql, /GROUP BY "tenantId"/);
      assert.equal(query.values[0].toISOString(), '2026-09-16T12:00:00.000Z');
      assert.equal(query.values[1], now);
      return counts;
    },
    tenantSlaTargetAlertState: alertState,
    $transaction: async (callback, options) => {
      assert.deepEqual(options, { timeout: 10_000 });
      const snapshot = new Map([...states].map(([key, value]) => [key, { ...value }]));
      try {
        return await callback({ tenantSlaTargetAlertState: alertState });
      } catch (error) {
        states.clear();
        for (const [key, value] of snapshot) states.set(key, value);
        throw error;
      }
    },
  };
  notificationService.notifyTenantUsers = async (payload, tx) => {
    assert.ok(tx.tenantSlaTargetAlertState);
    notifications.push(payload);
    return { count: recipients };
  };

  try {
    const service = new SlaTargetAlertService(db);
    assert.equal(await service.processDue(now), 1);
    assert.equal(states.get('tenant-a').isBelow, true);
    assert.equal(states.get('tenant-a').lastNotifiedAt, now);
    assert.equal(notifications[0].tenantId, 'tenant-a');
    assert.equal(notifications[0].type, 'tenant_sla_target_below');
    assert.equal(notifications[0].title, 'SLA poniżej celu');
    assert.equal(notifications[0].actionUrl, '/reports?slaDays=30&slaScope=all');
    assert.match(notifications[0].message, /80%.*95%.*5 zakończonych/);
    assert.deepEqual(notifications[0].requiredRoleCodes, ['SA', 'DA', 'TL', 'AT']);
    assert.equal(await service.processDue(now), 0);
    assert.equal(notifications.length, 1);

    counts = [{ tenantId: 'tenant-a', completed: 20, breached: 1 }];
    assert.equal(await service.processDue(now), 0);
    assert.equal(states.get('tenant-a').isBelow, false);
    counts = [{ tenantId: 'tenant-a', completed: 5, breached: 1 }];
    assert.equal(await service.processDue(now), 1);

    counts = [{ tenantId: 'tenant-a', completed: 4, breached: 1 }];
    assert.equal(await service.processDue(now), 0);
    assert.equal(states.get('tenant-a').isBelow, false);
    counts = [{ tenantId: 'tenant-a', completed: 5, breached: 1 }];
    recipients = 0;
    assert.equal(await service.processDue(now), 0);
    assert.equal(states.get('tenant-a').isBelow, false);
    recipients = 1;
    assert.equal(await service.processDue(now), 1);
    assert.equal(notifications.length, 4);
  } finally {
    notificationService.notifyTenantUsers = originalNotify;
  }
});
