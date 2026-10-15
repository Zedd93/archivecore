import assert from 'node:assert/strict';
import test from 'node:test';

process.env.TZ = 'Europe/Warsaw';
const slaModule = await import('../src/modules/orders/order-sla.ts');
const serviceModule = await import('../src/modules/orders/order-sla.service.ts');
const orderModule = await import('../src/modules/orders/order.service.ts');
const exportModule = await import('../src/modules/import-export/export.service.ts');
const tenantSlaModule = await import('../src/modules/tenants/tenant-sla.service.ts');
const { updateTenantSlaSchema } = await import('../../shared/src/validators/sla-policy.schema.ts');
const { previewOrderSlaQuerySchema } = await import('../../shared/src/validators/order.schema.ts');
const { businessMinutesBetween, createSlaSchedule, slaEscalationLevel, orderSlaLevel, slaRiskDeadlines, slaRiskWhere, subtractBusinessMinutes, slaLevelWhere } = slaModule;
const { OrderSlaService } = serviceModule;
const { OrderService } = orderModule;
const { ExportService } = exportModule;
const { tenantSlaService } = tenantSlaModule;
const { prisma } = await import('../src/config/database.ts');

test('business time excludes the weekend and time outside opening hours', () => {
  const friday = new Date('2026-10-16T13:00:00Z'); // 15:00 Warsaw
  const monday = new Date('2026-10-19T07:00:00Z'); // 09:00 Warsaw
  assert.equal(businessMinutesBetween(friday, monday), 120);
});

test('80, 100 and 120 percent are based on working time', () => {
  const deadline = new Date('2026-10-19T08:00:00Z'); // Monday 10:00 Warsaw
  assert.equal(slaEscalationLevel(deadline, 'urgent', new Date('2026-10-16T13:00:00Z')), null);
  assert.equal(slaEscalationLevel(deadline, 'urgent', new Date('2026-10-19T06:24:00Z')), 80);
  assert.equal(slaEscalationLevel(deadline, 'urgent', deadline), 100);
  assert.equal(slaEscalationLevel(deadline, 'urgent', new Date('2026-10-19T09:35:00Z')), 100);
  assert.equal(slaEscalationLevel(deadline, 'urgent', new Date('2026-10-19T09:36:00Z')), 120);
});

test('risk filter reaches across weekends and matches the displayed warning', () => {
  const now = new Date('2026-10-16T13:00:00Z'); // Friday 15:00 Warsaw
  const urgent = slaRiskDeadlines(now).find((item) => item.priority === 'urgent');
  assert.ok(urgent);
  assert.equal(urgent.deadline.toISOString(), '2026-10-19T06:36:00.000Z');
  assert.equal(businessMinutesBetween(now, urgent.deadline), 96);
  assert.equal(orderSlaLevel('submitted', urgent.deadline, 'urgent', now), 80);
  assert.equal(orderSlaLevel('submitted', new Date('2026-10-19T06:37:00Z'), 'urgent', now), null);
  assert.equal(orderSlaLevel('completed', new Date('2026-10-16T12:00:00Z'), 'urgent', now), null);
  assert.deepEqual(slaRiskWhere(now).status, { in: ['submitted', 'approved', 'in_progress', 'ready'] });
  const risk = slaRiskWhere(now);
  assert.deepEqual(risk.OR[0], { slaWarningAt: { lte: now } });
  assert.equal(risk.OR[1].slaWarningAt, null);
  assert.equal(risk.OR[1].OR.find((item) => item.priority === 'urgent').slaDeadline.lte.toISOString(), urgent.deadline.toISOString());
});

test('120 percent cutoff matches business-time escalation across a weekend', () => {
  const now = new Date('2026-10-19T07:00:00Z'); // Monday 09:00 Warsaw
  const cutoff = subtractBusinessMinutes(now, 96);
  assert.equal(cutoff.toISOString(), '2026-10-16T13:24:00.000Z'); // Friday 15:24 Warsaw
  assert.equal(slaEscalationLevel(cutoff, 'urgent', now), 120);
  assert.equal(slaEscalationLevel(new Date(cutoff.getTime() + 60_000), 'urgent', now), 100);
  const severe = slaLevelWhere(120, now);
  assert.deepEqual(severe.OR[0], { slaSevereAt: { lte: now } });
  assert.equal(severe.OR[1].slaSevereAt, null);
  assert.equal(severe.OR[1].OR.find((entry) => entry.priority === 'urgent').slaDeadline.lte.toISOString(), cutoff.toISOString());
  assert.deepEqual(slaLevelWhere(80, now).AND[1], { slaDeadline: { gt: now } });
  assert.deepEqual(slaLevelWhere(100, now).AND[0].status.in, ['submitted', 'approved', 'in_progress', 'ready']);
});

test('tenant-specific SLA snapshots use working hours and retain their own thresholds', () => {
  const start = new Date('2026-10-16T13:00:00Z'); // Friday 15:00 Warsaw
  const schedule = createSlaSchedule(start, 2);
  assert.equal(schedule.deadline.toISOString(), '2026-10-19T07:00:00.000Z');
  assert.equal(schedule.warningAt.toISOString(), '2026-10-19T06:36:00.000Z');
  assert.equal(schedule.severeAt.toISOString(), '2026-10-19T07:24:00.000Z');
  assert.equal(orderSlaLevel('submitted', schedule.deadline, 'normal', schedule.warningAt, schedule.warningAt, schedule.severeAt), 80);
  assert.equal(orderSlaLevel('submitted', schedule.deadline, 'normal', schedule.deadline, schedule.warningAt, schedule.severeAt), 100);
  assert.equal(orderSlaLevel('submitted', schedule.deadline, 'normal', schedule.severeAt, schedule.warningAt, schedule.severeAt), 120);
  assert.equal(orderSlaLevel('completed', schedule.deadline, 'normal', schedule.severeAt, schedule.warningAt, schedule.severeAt), null);
});

test('SLA policy input requires one valid duration for every service and priority', () => {
  const orderTypes = ['checkout', 'return_order', 'transfer', 'disposal', 'scan'];
  const priorities = ['normal', 'high', 'urgent'];
  const policies = orderTypes.flatMap((orderType) => priorities.map((priority) => ({ orderType, priority, hours: 10 })));
  assert.equal(updateTenantSlaSchema.safeParse({ policies }).success, true);
  assert.equal(updateTenantSlaSchema.safeParse({ policies: [...policies.slice(0, 14), policies[0]] }).success, false);
  assert.equal(updateTenantSlaSchema.safeParse({ policies: policies.map((policy, index) => index ? policy : { ...policy, hours: 0 }) }).success, false);
  assert.equal(updateTenantSlaSchema.safeParse({ policies: policies.map((policy, index) => index ? policy : { ...policy, hours: 241 }) }).success, false);
});

test('SLA preview accepts only supported order types and priorities', () => {
  assert.deepEqual(previewOrderSlaQuerySchema.parse({ orderType: 'scan' }), { orderType: 'scan', priority: 'normal' });
  assert.equal(previewOrderSlaQuerySchema.safeParse({ orderType: 'unknown', priority: 'high' }).success, false);
  assert.equal(previewOrderSlaQuerySchema.safeParse({ orderType: 'checkout', priority: 'unknown' }).success, false);
});

test('tenant SLA lookup falls back to defaults and never reads another tenant policy', async () => {
  const originalFindUnique = prisma.tenantSlaPolicy.findUnique;
  const queries = [];
  prisma.tenantSlaPolicy.findUnique = async ({ where }) => {
    queries.push(where);
    return where.tenantId_orderType_priority.tenantId === 'custom' ? { hours: 3 } : null;
  };
  try {
    assert.equal(await tenantSlaService.getHours('custom', 'scan', 'urgent'), 3);
    assert.equal(await tenantSlaService.getHours('other', 'scan', 'urgent'), 8);
    assert.deepEqual(queries.map((query) => query.tenantId_orderType_priority.tenantId), ['custom', 'other']);
  } finally {
    prisma.tenantSlaPolicy.findUnique = originalFindUnique;
  }
});

test('tenant SLA settings show defaults, mark overrides, and replace only that tenant in a transaction', async () => {
  const originalTenantFind = prisma.tenant.findUnique;
  const originalPolicyFind = prisma.tenantSlaPolicy.findMany;
  const originalTransaction = prisma.$transaction;
  const changes = [];
  prisma.tenant.findUnique = async ({ where }) => where.id === 'tenant-a' ? { id: 'tenant-a' } : null;
  prisma.tenantSlaPolicy.findMany = async ({ where }) => {
    assert.equal(where.tenantId, 'tenant-a');
    return [{ orderType: 'scan', priority: 'urgent', hours: 3 }];
  };
  prisma.$transaction = async (callback) => callback({
    tenant: { findUnique: prisma.tenant.findUnique },
    tenantSlaPolicy: {
      deleteMany: async ({ where }) => { changes.push(['delete', where.tenantId]); },
      createMany: async ({ data }) => { changes.push(['create', data]); },
    },
  });
  try {
    const matrix = await tenantSlaService.list('tenant-a');
    assert.equal(matrix.length, 15);
    assert.deepEqual(matrix.find((policy) => policy.orderType === 'scan' && policy.priority === 'urgent'), {
      orderType: 'scan', priority: 'urgent', hours: 3, isCustom: true,
    });
    assert.deepEqual(matrix.find((policy) => policy.orderType === 'checkout' && policy.priority === 'normal'), {
      orderType: 'checkout', priority: 'normal', hours: 48, isCustom: false,
    });
    await assert.rejects(tenantSlaService.list('missing'), /Tenant nie znaleziony/);
    await tenantSlaService.replace('tenant-a', matrix.map(({ orderType, priority, hours }) => ({ orderType, priority, hours })));
    assert.deepEqual(changes[0], ['delete', 'tenant-a']);
    assert.equal(changes[1][0], 'create');
    assert.equal(changes[1][1].length, 15);
    assert.ok(changes[1][1].every((policy) => policy.tenantId === 'tenant-a'));
  } finally {
    prisma.tenant.findUnique = originalTenantFind;
    prisma.tenantSlaPolicy.findMany = originalPolicyFind;
    prisma.$transaction = originalTransaction;
  }
});

test('submission starts a fresh SLA window instead of using draft creation time', () => {
  const service = new OrderService();
  const before = new Date();
  const update = service.getStatusUpdateData({ priority: 'urgent', notes: null }, 'submitted', 'requester');
  assert.ok(update.slaDeadline instanceof Date);
  assert.ok(update.slaDeadline > before);
});

test('submitting an order snapshots the selected tenant policy and its thresholds', async () => {
  const originalFindUnique = prisma.tenantSlaPolicy.findUnique;
  const service = new OrderService();
  prisma.tenantSlaPolicy.findUnique = async ({ where }) => {
    assert.deepEqual(where.tenantId_orderType_priority, { tenantId: 'tenant-a', orderType: 'scan', priority: 'high' });
    return { hours: 3 };
  };
  try {
    const schedule = await service.getSlaSchedule('tenant-a', 'scan', 'high');
    const update = service.getStatusUpdateData({ priority: 'high', notes: null }, 'submitted', 'requester', undefined, schedule);
    assert.equal(update.slaHours, 3);
    assert.equal(update.slaDeadline.toISOString(), schedule.deadline.toISOString());
    assert.equal(update.slaWarningAt.toISOString(), schedule.warningAt.toISOString());
    assert.equal(update.slaSevereAt.toISOString(), schedule.severeAt.toISOString());
  } finally {
    prisma.tenantSlaPolicy.findUnique = originalFindUnique;
  }
});

test('SLA preview uses the same selected tenant policy and deadline calculation as submission', async () => {
  const originalFindUnique = prisma.tenantSlaPolicy.findUnique;
  prisma.tenantSlaPolicy.findUnique = async ({ where }) => {
    assert.deepEqual(where.tenantId_orderType_priority, { tenantId: 'tenant-a', orderType: 'scan', priority: 'high' });
    return { hours: 3 };
  };
  try {
    const before = new Date();
    const preview = await new OrderService().previewSla('tenant-a', 'scan', 'high');
    const after = new Date();
    assert.equal(preview.hours, 3);
    assert.ok(preview.calculatedAt >= before && preview.calculatedAt <= after);
    assert.equal(preview.deadline.toISOString(), createSlaSchedule(preview.calculatedAt, 3).deadline.toISOString());
  } finally {
    prisma.tenantSlaPolicy.findUnique = originalFindUnique;
  }
});

test('worker sends one warning and records its level across runs', async () => {
  const deadline = new Date('2026-10-19T08:00:00Z');
  const now = new Date('2026-10-19T06:30:00Z');
  const markers = [];
  const notifications = [];
  const order = {
    id: 'order-1', tenantId: 'tenant-1', orderNumber: 'Z-1',
    priority: 'urgent', status: 'submitted', slaDeadline: deadline,
    assignedTo: null, slaEscalations: markers,
  };
  const db = {
    order: {
      findMany: async (query) => {
        assert.deepEqual(query.where.status.in, ['submitted', 'approved', 'in_progress', 'ready']);
        assert.deepEqual(query.where.slaEscalations, { none: { level: 120 } });
        return [order];
      },
      findFirst: async () => order,
    },
    orderSlaEscalation: {
      create: async ({ data }) => {
        markers.push({ level: data.level });
        return data;
      },
    },
    user: {
      findMany: async () => [{ id: 'operator', userRoles: [{ role: { code: 'OM' } }] }],
    },
    notification: {
      createMany: async ({ data }) => {
        notifications.push(...data);
        return { count: data.length };
      },
    },
  };
  db.$transaction = async (callback) => callback(db);
  const service = new OrderSlaService(db);
  assert.equal(await service.processDue(now), 1);
  assert.equal(await new OrderSlaService(db).processDue(now), 0);
  assert.deepEqual(markers, [{ level: 80 }]);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].userId, 'operator');
  assert.equal(notifications[0].type, 'order_sla_80');
});

test('at-risk order list keeps tenant and department scope while paginating', async () => {
  const originalFindMany = prisma.order.findMany;
  const originalCount = prisma.order.count;
  let listQuery;
  let countWhere;
  prisma.order.findMany = async (query) => {
    listQuery = query;
    return [{
      id: 'order-1', tenantId: 'tenant-a', status: 'submitted',
      priority: 'urgent', slaDeadline: new Date(Date.now() - 24 * 60 * 60_000),
    }];
  };
  prisma.order.count = async ({ where }) => {
    countWhere = where;
    return 23;
  };
  try {
    const result = await new OrderService().list('tenant-a', { slaRisk: 'true' }, 20, 20, 'Księgowość');
    assert.equal(result.total, 23);
    assert.equal(result.data.length, 1);
    assert.ok(result.data[0].slaLevel === 100 || result.data[0].slaLevel === 120);
    assert.equal(listQuery.skip, 20);
    assert.equal(listQuery.take, 20);
    assert.deepEqual(listQuery.orderBy, [{ slaDeadline: 'asc' }, { id: 'asc' }]);
    assert.equal(listQuery.where.tenantId, 'tenant-a');
    assert.equal(listQuery.where.AND[0].AND[1].items.every.OR[0].box.department.equals, 'Księgowość');
    assert.deepEqual(listQuery.where.AND[1].status.in, ['submitted', 'approved', 'in_progress', 'ready']);
    assert.deepEqual(countWhere, listQuery.where);
  } finally {
    prisma.order.findMany = originalFindMany;
    prisma.order.count = originalCount;
  }
});

test('SLA summary counts each level within the tenant and department scope', async () => {
  const originalCount = prisma.order.count;
  const queries = [];
  prisma.order.count = async ({ where }) => {
    queries.push(where);
    return queries.length;
  };
  try {
    const summary = await new OrderService().getSlaSummary('tenant-a', 'Księgowość');
    assert.deepEqual(summary, { warning: 1, overdue: 2, escalated: 3, total: 6 });
    assert.equal(queries.length, 3);
    for (const query of queries) {
      assert.equal(query.AND[0].tenantId, 'tenant-a');
      assert.equal(query.AND[0].AND[0].AND[1].items.every.OR[0].box.department.equals, 'Księgowość');
    }
    assert.ok(queries[0].AND[1].AND);
    assert.ok(queries[1].AND[1].AND);
    assert.ok(queries[2].AND[1].OR);
  } finally {
    prisma.order.count = originalCount;
  }
});

test('level filter uses the same scoped condition and deadline order as the summary', async () => {
  const originalFindMany = prisma.order.findMany;
  const originalCount = prisma.order.count;
  let query;
  prisma.order.findMany = async (input) => { query = input; return []; };
  prisma.order.count = async () => 0;
  try {
    await new OrderService().list('tenant-a', { slaLevel: '120' }, 0, 20, 'Księgowość');
    assert.equal(query.where.tenantId, 'tenant-a');
    assert.equal(query.where.AND[0].AND[1].items.every.OR[0].box.department.equals, 'Księgowość');
    assert.deepEqual(query.where.AND[1].status.in, ['submitted', 'approved', 'in_progress', 'ready']);
    assert.deepEqual(query.orderBy, [{ slaDeadline: 'asc' }, { id: 'asc' }]);
  } finally {
    prisma.order.findMany = originalFindMany;
    prisma.order.count = originalCount;
  }
});

test('order export uses the same at-risk filter as the list', async () => {
  const originalFindMany = prisma.order.findMany;
  let exportQuery;
  prisma.order.findMany = async (query) => {
    exportQuery = query;
    return [];
  };
  try {
    await new ExportService().exportOrders('tenant-a', { slaRisk: 'true' }, 'csv', 'Księgowość');
    assert.equal(exportQuery.where.tenantId, 'tenant-a');
    assert.equal(exportQuery.where.AND[0].AND[1].items.every.OR[0].box.department.equals, 'Księgowość');
    assert.deepEqual(exportQuery.where.AND[1].status.in, ['submitted', 'approved', 'in_progress', 'ready']);
    assert.deepEqual(exportQuery.orderBy, [{ slaDeadline: 'asc' }, { id: 'asc' }]);
  } finally {
    prisma.order.findMany = originalFindMany;
  }
});

test('order export applies the selected SLA level without dropping department scope', async () => {
  const originalFindMany = prisma.order.findMany;
  let query;
  prisma.order.findMany = async (input) => { query = input; return []; };
  try {
    await new ExportService().exportOrders('tenant-a', { slaLevel: '100' }, 'csv', 'Księgowość');
    assert.equal(query.where.tenantId, 'tenant-a');
    assert.equal(query.where.AND[0].AND[1].items.every.OR[0].box.department.equals, 'Księgowość');
    assert.deepEqual(query.where.AND[1].AND[0].status.in, ['submitted', 'approved', 'in_progress', 'ready']);
    assert.deepEqual(query.orderBy, [{ slaDeadline: 'asc' }, { id: 'asc' }]);
  } finally {
    prisma.order.findMany = originalFindMany;
  }
});

test('legacy overdue endpoint is limited to active orders in the same department', async () => {
  const originalFindMany = prisma.order.findMany;
  let query;
  prisma.order.findMany = async (input) => { query = input; return []; };
  try {
    await new OrderService().getOverdueSla('tenant-a', 'Księgowość');
    assert.equal(query.where.tenantId, 'tenant-a');
    assert.deepEqual(query.where.status.in, ['submitted', 'approved', 'in_progress', 'ready']);
    assert.equal(query.where.AND[0].AND[1].items.every.OR[0].box.department.equals, 'Księgowość');
  } finally {
    prisma.order.findMany = originalFindMany;
  }
});
