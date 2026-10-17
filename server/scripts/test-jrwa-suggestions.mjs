import assert from 'node:assert/strict';
import test from 'node:test';

const { prisma } = await import('../src/config/database.ts');
const { jrwaSuggestionService } = await import('../src/modules/retention/jrwa-suggestion.service.ts');
const { TransferListService } = await import('../src/modules/transfer-lists/transfer-list.service.ts');
const tenantId = 'f80b1605-370b-430f-bcda-4edbcefa2d18';
const policyId = '60ed7e39-af84-4d36-ab21-6ca41969449f';

test('suggestions are scoped to the tenant and its current JRWA version', async () => {
  const originalVersion = prisma.jrwaVersion.findFirst;
  const originalPolicies = prisma.retentionPolicy.findMany;
  prisma.jrwaVersion.findFirst = async ({ where }) => {
    assert.equal(where.tenantId, tenantId);
    return { id: 'current-version' };
  };
  prisma.retentionPolicy.findMany = async ({ where, take }) => {
    assert.equal(where.tenantId, tenantId);
    assert.equal(where.jrwaVersionId, 'current-version');
    assert.equal(where.isActive, true);
    assert.equal(where.OR[0].jrwaCode.equals, '1234');
    assert.equal(take, 30);
    return [{ id: policyId, jrwaCode: '1234' }];
  };
  try {
    assert.deepEqual(await jrwaSuggestionService.suggest(tenantId, '1234'), [{ id: policyId, jrwaCode: '1234' }]);
    assert.deepEqual(await jrwaSuggestionService.suggest(tenantId, ''), []);
  } finally {
    prisma.jrwaVersion.findFirst = originalVersion;
    prisma.retentionPolicy.findMany = originalPolicies;
  }
});

test('legacy JRWA entries remain searchable until a dated version becomes effective', async () => {
  const originalVersion = prisma.jrwaVersion.findFirst;
  const originalPolicies = prisma.retentionPolicy.findMany;
  prisma.jrwaVersion.findFirst = async () => null;
  prisma.retentionPolicy.findMany = async ({ where }) => {
    assert.equal(where.tenantId, tenantId);
    assert.equal(where.jrwaVersionId, null);
    return [{ id: policyId }];
  };
  try {
    assert.deepEqual(await jrwaSuggestionService.suggest(tenantId, 'Akta'), [{ id: policyId }]);
  } finally {
    prisma.jrwaVersion.findFirst = originalVersion;
    prisma.retentionPolicy.findMany = originalPolicies;
  }
});

test('selected policy must belong to the tenant, current version and selected category', async () => {
  const originalVersion = prisma.jrwaVersion.findFirst;
  const originalPolicy = prisma.retentionPolicy.findFirst;
  let foundPolicy = { id: policyId, archivalCategory: 'B10', jrwaVersionId: 'current-version', isActive: true };
  prisma.jrwaVersion.findFirst = async () => ({ id: 'current-version' });
  prisma.retentionPolicy.findFirst = async ({ where }) => {
    assert.equal(where.tenantId, tenantId);
    return foundPolicy;
  };
  try {
    assert.equal(await jrwaSuggestionService.validateSelection(tenantId, policyId, 'B10'), policyId);
    await assert.rejects(jrwaSuggestionService.validateSelection(tenantId, policyId, 'B50'), { statusCode: 400 });
    foundPolicy = { ...foundPolicy, jrwaVersionId: 'old-version' };
    await assert.rejects(jrwaSuggestionService.validateSelection(tenantId, policyId, 'B10'), { statusCode: 409 });
    assert.equal(await jrwaSuggestionService.validateSelection(tenantId, policyId, 'B10', policyId), policyId);
    prisma.retentionPolicy.findFirst = async () => null;
    await assert.rejects(jrwaSuggestionService.validateSelection(tenantId, policyId, 'B10'), { statusCode: 400 });
  } finally {
    prisma.jrwaVersion.findFirst = originalVersion;
    prisma.retentionPolicy.findFirst = originalPolicy;
  }
});

test('confirmed JRWA selection is stored on the canonical folder', async () => {
  const service = new TransferListService();
  service.getById = async () => ({ id: 'list-a', tenantId, status: 'draft', listNumber: 'S-1' });
  service.resolveTransferListBox = async () => ({ boxId: null, sourceBoxNumber: null });
  const originalValidation = jrwaSuggestionService.validateSelection;
  const originalFindFirst = prisma.transferListItem.findFirst;
  const originalTransaction = prisma.$transaction;
  const writes = [];
  jrwaSuggestionService.validateSelection = async (...args) => {
    assert.deepEqual(args.slice(0, 3), [tenantId, policyId, 'B10']);
    return policyId;
  };
  prisma.transferListItem.findFirst = async () => null;
  const tx = {
    folder: { create: async ({ data }) => { writes.push(data); return { id: 'folder-a' }; } },
    transferListItem: { create: async ({ data }) => { writes.push(data); return data; } },
  };
  prisma.$transaction = async (fn) => fn(tx);
  try {
    const data = { folderSignature: '1234/2026', folderTitle: 'Umowy', categoryCode: 'B10', retentionPolicyId: policyId };
    const item = await service.addItem('list-a', tenantId, 'user-a', data);
    assert.equal(writes[0].retentionPolicyId, policyId);
    assert.equal(item.folderId, 'folder-a');
    assert.equal(item.categoryCode, 'B10');
  } finally {
    jrwaSuggestionService.validateSelection = originalValidation;
    prisma.transferListItem.findFirst = originalFindFirst;
    prisma.$transaction = originalTransaction;
  }
});

test('editing a historically classified folder preserves its policy link', async () => {
  const service = new TransferListService();
  service.getById = async () => ({ id: 'list-a', tenantId, status: 'draft', listNumber: 'S-1' });
  service.resolveTransferListBox = async () => ({ boxId: null, sourceBoxNumber: null });
  const originalValidation = jrwaSuggestionService.validateSelection;
  const originalFindFirst = prisma.transferListItem.findFirst;
  const originalTransaction = prisma.$transaction;
  jrwaSuggestionService.validateSelection = async (...args) => {
    assert.deepEqual(args, [tenantId, policyId, 'B10', policyId]);
    return policyId;
  };
  prisma.transferListItem.findFirst = async () => ({
    id: 'item-a', folderId: 'folder-a', ordinalNumber: 1, categoryCode: 'B10',
    folder: { retentionPolicyId: policyId },
  });
  let updatedFolder;
  const tx = {
    folder: { update: async ({ data }) => { updatedFolder = data; } },
    transferListItem: { update: async ({ data }) => data },
  };
  prisma.$transaction = async (fn) => fn(tx);
  try {
    const data = { folderSignature: '1234/2026', folderTitle: 'Umowy zmienione', categoryCode: 'B10' };
    await service.updateItem('list-a', 'item-a', tenantId, 'user-a', data);
    assert.equal(updatedFolder.retentionPolicyId, policyId);
  } finally {
    jrwaSuggestionService.validateSelection = originalValidation;
    prisma.transferListItem.findFirst = originalFindFirst;
    prisma.$transaction = originalTransaction;
  }
});
