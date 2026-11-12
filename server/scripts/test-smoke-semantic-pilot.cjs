const test = require('node:test');
const assert = require('node:assert/strict');
const { Permissions, RoleCode } = require('@archivecore/shared');
const { parseArgs, smokePilot } = require('./smoke-semantic-pilot.cjs');

const TENANT_ID = '11111111-1111-4111-8111-111111111111';

test('smoke command accepts only bounded queries for the approved tenant', () => {
  assert.deepEqual(parseArgs(['--tenant', 'SMPOLI', '--query', 'akta budynku']), {
    tenant: 'SMPOLI', query: 'akta budynku', top: 5,
  });
  assert.equal(parseArgs(['--tenant', 'smpoli', '--query', 'akta budynku', '--top', '10']).top, 10);
  assert.throws(() => parseArgs(['--tenant', 'INNY', '--query', 'akta budynku']), /Uzycie/);
  assert.throws(() => parseArgs(['--tenant', 'SMPOLI', '--query', 'akta budynku', '--top', '11']), /Uzycie/);
  assert.throws(() => parseArgs(['--tenant', 'SMPOLI', '--query', 'akta budynku', '--top', '2', '--top', '3']), /powtorzony/);
  assert.throws(() => parseArgs(['--tenant', 'SMPOLI', '--query', 'ab']), /Uzycie/);
});

test('smoke command passes a scoped read context to the live pilot service', async () => {
  const options = parseArgs(['--tenant', 'SMPOLI', '--query', 'akta budynku', '--top', '3']);
  const results = [{ type: 'folder', id: TENANT_ID, title: 'Aktualny tytul', href: `/folders/${TENANT_ID}` }];
  const dependencies = {
    production: { tenant: { findFirst: async ({ where, select }) => {
      assert.equal(where.shortCode.equals, 'SMPOLI');
      assert.deepEqual(select, { id: true, shortCode: true });
      return { id: TENANT_ID, shortCode: 'SMPOLI' };
    } } },
    staging: {}, stagingUrl: 'staging', stagingDataDir: 'data',
    run: async (context, query, limit, deps) => {
      assert.equal(context.tenantId, TENANT_ID);
      assert.deepEqual(context.roles, [RoleCode.SUPER_ADMIN]);
      assert.ok(context.permissions.includes(Permissions.SEARCH_ALL));
      assert.ok(context.permissions.includes(Permissions.FOLDER_READ));
      assert.ok(context.permissions.includes(Permissions.TRANSFER_LIST_READ));
      assert.equal(query, 'akta budynku');
      assert.equal(limit, 3);
      assert.equal(deps.staging, dependencies.staging);
      assert.equal(deps.production, dependencies.production);
      return results;
    },
  };
  assert.deepEqual(await smokePilot(options, dependencies), { tenant: 'SMPOLI', results });
});

test('unknown tenant does not run the semantic query', async () => {
  const dependencies = {
    production: { tenant: { findFirst: async () => null } },
    run: async () => assert.fail('query should not run'),
  };
  await assert.rejects(smokePilot({ tenant: 'SMPOLI', query: 'akta', top: 5 }, dependencies), /Nie znaleziono/);
});
