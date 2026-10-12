const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('offline navigation shows a status page without caching private API responses', async () => {
  const handlers = {};
  const cached = new Map();
  let online = true;
  let requested = 0;
  const offlinePage = { kind: 'offline-page' };
  const self = {
    location: { origin: 'https://archivecore.doxart.pl' },
    addEventListener: (name, handler) => { handlers[name] = handler; },
    skipWaiting: () => {},
    clients: { claim: () => {} },
  };
  const caches = {
    open: async () => ({
      addAll: async (paths) => {
        assert.ok(paths.includes('/offline.html'));
        for (const item of paths) cached.set(item, item === '/offline.html' ? offlinePage : { kind: 'asset' });
      },
      put: async () => {},
    }),
    match: async (key) => cached.get(key),
    keys: async () => ['archivecore-v6', 'other-app-cache'],
    delete: async (key) => { assert.equal(key, 'archivecore-v6'); return true; },
  };
  const fetch = async () => {
    requested++;
    if (!online) throw new Error('network unavailable');
    return { kind: 'network' };
  };
  const source = fs.readFileSync(path.join(__dirname, '../public/sw.js'), 'utf8');
  vm.runInNewContext(source, { self, caches, fetch, URL, Response: { error: () => ({ kind: 'error' }) } });

  let pending;
  handlers.install({ waitUntil: (promise) => { pending = promise; } });
  await pending;
  handlers.activate({ waitUntil: (promise) => { pending = promise; } });
  await pending;

  const navigate = { method: 'GET', mode: 'navigate', url: 'https://archivecore.doxart.pl/warehouse' };
  handlers.fetch({ request: navigate, respondWith: (promise) => { pending = promise; } });
  assert.equal((await pending).kind, 'network');

  online = false;
  handlers.fetch({ request: navigate, respondWith: (promise) => { pending = promise; } });
  assert.equal(await pending, offlinePage);

  let intercepted = false;
  handlers.fetch({ request: { method: 'GET', mode: 'cors', url: 'https://archivecore.doxart.pl/api/orders' }, respondWith: () => { intercepted = true; } });
  assert.equal(intercepted, false);
  assert.equal(requested, 2);
});
