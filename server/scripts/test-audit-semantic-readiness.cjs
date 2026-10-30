const assert = require('node:assert/strict');
const test = require('node:test');
const { auditSemanticReadiness, printReport } = require('./audit-semantic-readiness.cjs');

test('read-only audit reports extension and searchable OCR coverage', async () => {
  const queries = [];
  const db = { $queryRaw: async (parts) => {
    queries.push(parts.join(''));
    return queries.length === 1
      ? [{ postgresVersion: '16.4', vectorAvailable: false, vectorEnabled: false }]
      : [{ attachments: 12, withOcrText: 3, ocrCompleted: 2 }];
  } };
  const result = await auditSemanticReadiness(db);
  assert.deepEqual(result, {
    postgresVersion: '16.4', vectorAvailable: false, vectorEnabled: false,
    attachments: 12, withOcrText: 3, ocrCompleted: 2,
  });
  assert.equal(queries.length, 2);
  assert.ok(queries.every((query) => /^\s*SELECT\b/i.test(query)));
  assert.match(queries[1], /NOT EXISTS \(SELECT 1 FROM hr_documents/);
  assert.match(queries[1], /"tenantId" = a\."tenantId"/);
});

test('report does not reveal document contents or identifiers', () => {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    printReport({ postgresVersion: '16.4', vectorAvailable: true, vectorEnabled: false,
      attachments: 12, withOcrText: 3, ocrCompleted: 2 });
  } finally {
    console.log = original;
  }
  assert.match(lines.join('\n'), /Z tekstem OCR: 3/);
  assert.doesNotMatch(lines.join('\n'), /PESEL|fileName|attachmentId/);
});
