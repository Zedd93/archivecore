import assert from 'node:assert/strict';
import test from 'node:test';
import { toOrderDraftItem, readOrderDraft } from '../src/utils/orderDraft.ts';

test('only orderable search results enter an order draft', () => {
  assert.deepEqual(toOrderDraftItem({ type: 'folder', id: 'folder-1', title: 'Folder 1', metadata: { source: 'transfer_list_item' } }), {
    type: 'folder', id: 'folder-1', title: 'Folder 1', boxNumber: undefined, source: 'transfer_list',
  });
  assert.equal(toOrderDraftItem({ type: 'document', id: 'file-1', title: 'Scan', metadata: { source: 'attachment' } }), null);
  assert.equal(toOrderDraftItem({ type: 'document', id: 'hr-1', title: 'HR', metadata: { source: 'hr_document' } }), null);
  assert.equal(toOrderDraftItem({ type: 'hr_folder', id: 'hr-2', title: 'HR folder' }), null);
});

test('draft is limited to current tenant and duplicate items are ignored', () => {
  const state = { orderDraft: { tenantId: 'tenant-a', items: [
    { type: 'box', id: 'box-1', title: 'Box 1' },
    { type: 'box', id: 'box-1', title: 'Box 1' },
    { type: 'folder', id: 'folder-1', title: 'Folder 1' },
    { type: 'hr_folder', id: 'hr-1', title: 'HR' },
  ] } };
  assert.equal(readOrderDraft(state, 'tenant-b').length, 0);
  assert.equal(readOrderDraft(state, 'tenant-a').length, 2);
  assert.equal(readOrderDraft(null, 'tenant-a').length, 0);
});
