const test = require('node:test');
const assert = require('node:assert/strict');
const { auditBoxLoanStatus, classifyBoxLoanStatus } = require('./audit-box-loan-status.cjs');

test('active whole-box loan justifies checked_out even alongside partial loans', () => {
  assert.equal(classifyBoxLoanStatus({ status: 'checked_out', activeWholeLoans: 1, activePartialLoans: 2, historicalPartialLoans: 2 }), 'whole_box_loan');
});

test('partial loans remain review candidates, not automatic repairs', () => {
  assert.equal(classifyBoxLoanStatus({ status: 'checked_out', activeWholeLoans: 0, activePartialLoans: 1, historicalPartialLoans: 1 }), 'active_partial_loan');
  assert.equal(classifyBoxLoanStatus({ status: 'checked_out', activeWholeLoans: 0, activePartialLoans: 0, historicalPartialLoans: 1 }), 'past_partial_loan');
  assert.equal(classifyBoxLoanStatus({ status: 'checked_out', activeWholeLoans: 0, activePartialLoans: 0, historicalPartialLoans: 0 }), 'no_loan_evidence');
  assert.equal(classifyBoxLoanStatus({ status: 'active', activeWholeLoans: 1 }), 'active_with_whole_box_loan');
});

test('audit classifies records without mutating the database', async () => {
  let queryCount = 0;
  const rows = await auditBoxLoanStatus({
    async $queryRaw() {
      queryCount++;
      if (queryCount === 1) return [
        { id: 'box-1', status: 'checked_out', activeWholeLoans: 0, activePartialLoans: 1, historicalPartialLoans: 1 },
        { id: 'box-2', status: 'checked_out', activeWholeLoans: 1, activePartialLoans: 0, historicalPartialLoans: 0 },
      ];
      return [{ id: 'box-3', status: 'active', activeWholeLoans: 1, activePartialLoans: 0, historicalPartialLoans: 0 }];
    },
  });
  assert.equal(queryCount, 2);
  assert.deepEqual(rows.map((row) => [row.id, row.classification]), [
    ['box-1', 'active_partial_loan'],
    ['box-2', 'whole_box_loan'],
    ['box-3', 'active_with_whole_box_loan'],
  ]);
});
