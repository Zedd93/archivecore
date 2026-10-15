const test = require('node:test');
const assert = require('node:assert/strict');
const { auditBillingAmounts } = require('./audit-billing-amounts.cjs');

test('billing amount audit is read-only and checks quantity times unit price', async () => {
  let query = '';
  const rows = [{ id: 'event-1', status: 'pending' }];
  const db = {
    $queryRaw: async (strings) => {
      query = strings.join('');
      return rows;
    },
  };

  assert.equal(await auditBillingAmounts(db), rows);
  assert.match(query, /"quantity" <> 1/);
  assert.match(query, /"netAmount" <> ROUND\(e\."quantity" \* e\."unitPrice", 2\)/);
  assert.match(query, /"unitPrice" IS NOT NULL/);
  assert.doesNotMatch(query, /UPDATE|DELETE|INSERT/i);
});
