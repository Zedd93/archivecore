const test = require('node:test');
const assert = require('node:assert/strict');
const { Permissions, RoleCode } = require('@archivecore/shared');
const { semanticMetadataChecksum } = require('../dist/modules/search/semantic-checksum');
const { runSemanticPilot, validateStagingConfig } = require('../dist/modules/search/semantic-pilot.service');

const TENANT = '11111111-1111-4111-8111-111111111111';
const FOLDER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const DATA = 'C:\\Apps\\PostgreSQL-Staging\\data';
const STAGING_URL = 'postgresql://u:p@127.0.0.1:55433/archivecore_staging';
const digest = 'a'.repeat(64);
const source = { id: FOLDER, title: 'Aktualny tytuł', description: 'Rok 2025', docType: null, box: { department: 'Księgowość' } };
const checksum = semanticMetadataChecksum({
  sourceType: 'folder', text: 'Aktualny tytuł | Rok 2025', department: 'Księgowość',
});
const context = {
  tenantId: TENANT, department: 'Księgowość', roles: [RoleCode.SUPER_ADMIN],
  permissions: [Permissions.SEARCH_ALL, Permissions.FOLDER_READ],
};

function dependencies(indexChecksum = checksum) {
  const calls = [];
  const staging = {
    $queryRawUnsafe: async (sql, ...params) => {
      calls.push({ sql, params });
      if (calls.length === 1) return [{
        database: 'archivecore_staging', dataDirectory: 'C:/Apps/PostgreSQL-Staging/data', vectorEnabled: true,
      }];
      return [{ type: 'folder', id: FOLDER, checksum: indexChecksum, title: 'Nie ufaj indeksowi', score: 0.999 }];
    },
  };
  const production = {
    folder: { findMany: async ({ where }) => {
      assert.equal(where.tenantId, TENANT);
      assert.equal(where.box.is.department.equals, 'Księgowość');
      return [source];
    } },
    transferList: { findMany: async () => { throw new Error('list query not expected'); } },
  };
  const fetcher = async (url, options) => {
    if (url.endsWith('/api/tags')) return { ok: true, json: async () => ({ models: [{ name: 'bge-m3:latest', digest }] }) };
    assert.ok(url.endsWith('/api/embed'));
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body).input, ['faktury za 2025']);
    return { ok: true, json: async () => ({ embeddings: [[1, ...Array(1023).fill(0)]] }) };
  };
  return { calls, staging, production, fetcher, stagingUrl: STAGING_URL, stagingDataDir: DATA };
}

test('pilot configuration refuses production and non-loopback databases', () => {
  assert.doesNotThrow(() => validateStagingConfig(STAGING_URL, DATA));
  assert.throws(() => validateStagingConfig('postgresql://u:p@127.0.0.1:5432/archivecore', DATA), /izolowanego/);
  assert.throws(() => validateStagingConfig('postgresql://u:p@remote:55433/archivecore_staging', DATA), /izolowanego/);
  assert.throws(() => validateStagingConfig(STAGING_URL, 'C:\\Program Files\\PostgreSQL\\16\\data'), /izolowanego/);
});

test('pilot returns only a current authorized title after scoped vector lookup', async () => {
  const deps = dependencies();
  const results = await runSemanticPilot(context, 'faktury za 2025', 5, deps);
  assert.deepEqual(results, [{ type: 'folder', id: FOLDER, title: 'Aktualny tytuł', href: `/folders/${FOLDER}` }]);
  assert.equal(deps.calls.length, 2);
  assert.match(deps.calls[1].sql, /WHERE tenant_id = \$1::uuid AND model_version = \$2/);
  assert.match(deps.calls[1].sql, /department_key = \$3/);
  assert.deepEqual(deps.calls[1].params.slice(0, 3), [TENANT, `bge-m3@${digest}`, 'księgowość']);
  assert.equal(JSON.stringify(results).includes('Nie ufaj indeksowi'), false);
  assert.equal(JSON.stringify(results).includes('score'), false);
});

test('stale checksum prevents a result even when the indexed ID exists', async () => {
  const deps = dependencies('b'.repeat(64));
  assert.deepEqual(await runSemanticPilot(context, 'faktury za 2025', 5, deps), []);
});

test('non-superadmin cannot call model or staging index', async () => {
  const deps = dependencies();
  await assert.rejects(runSemanticPilot({ ...context, roles: [RoleCode.TENANT_LEADERSHIP] }, 'faktury za 2025', 5, deps), /Brak dostepu/);
  assert.deepEqual(deps.calls, []);
});

test('wrong physical cluster is rejected before embedding or title lookup', async () => {
  const deps = dependencies();
  deps.staging.$queryRawUnsafe = async () => [{
    database: 'archivecore_staging', dataDirectory: 'C:/Program Files/PostgreSQL/16/data', vectorEnabled: true,
  }];
  deps.fetcher = async () => { throw new Error('must not call model'); };
  await assert.rejects(runSemanticPilot(context, 'faktury za 2025', 5, deps), /oczekiwanym klastrem/);
});

test('semantic pilot route is hidden when the feature flag is disabled', () => {
  delete process.env.SEMANTIC_PILOT_ENABLED;
  const router = require('../dist/modules/search/search.routes').default;
  const route = router.stack.find((layer) => layer.route?.path === '/semantic-pilot')?.route;
  assert.ok(route);
  let status;
  let body;
  const response = {
    status(code) { status = code; return this; },
    json(value) { body = value; return this; },
  };
  route.stack[0].handle({}, response, () => assert.fail('disabled pilot passed the route guard'));
  assert.equal(status, 404);
  assert.deepEqual(body, { success: false, error: 'Nie znaleziono zasobu' });
});
