import { beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { staticAssetsPlugin } from '../static-assets-plugin.mjs';

const source = readFileSync(new URL('../static-worker.js', import.meta.url), 'utf8');
const origin = 'https://app.test';
let stores, cacheStorage, network;
function key(request) { return typeof request === 'string' ? request : request.url; }
function worker(build, assets) {
  const handlers = {};
  const scope = { location: { origin }, addEventListener: (name, fn) => { handlers[name] = fn; }, skipWaiting: vi.fn(), clients: { claim: vi.fn() } };
  const compiled = source.replace("'__SW_BUILD__'", JSON.stringify(build)).replace("'__SW_ASSETS__'", JSON.stringify(assets));
  new Function('self', 'caches', 'fetch', compiled)(scope, cacheStorage, network);
  return {
    scope,
    install: async () => { let pending; handlers.install({ waitUntil: p => { pending = p; } }); await pending; },
    activate: async () => { let pending; handlers.activate({ waitUntil: p => { pending = p; } }); await pending; },
    fetch: async (path, method = 'GET') => {
      let pending; handlers.fetch({ request: new Request(new URL(path, origin), { method }), respondWith: p => { pending = p; } }); return pending ? await pending : null;
    },
  };
}
beforeEach(() => {
  stores = new Map();
  cacheStorage = { keys: async () => [...stores.keys()], delete: async name => stores.delete(name), open: async name => {
    if (!stores.has(name)) stores.set(name, new Map()); const store = stores.get(name);
    return { match: async req => store.get(key(req))?.clone(), put: async (req, response) => { store.set(key(req), response.clone()); } };
  } };
  network = vi.fn(async req => new Response('module:' + new URL(req.url).pathname, { headers: { 'content-type': req.url.endsWith('.css') ? 'text/css' : 'text/javascript' } }));
});
it('keeps the exact old lazy module after a new deployment removes it, even under the new worker', async () => {
  const old = '/assets/FinanceWorkbenchPage-oldAAAAA.js', next = '/assets/FinanceWorkbenchPage-newBBBBB.js';
  const a = worker('a'.repeat(40), [old]); await a.install(); await a.activate();
  network.mockImplementation(async req => new Response(req.url.endsWith(next) ? 'NEW_MODULE' : 'not found', { status: req.url.endsWith(next) ? 200 : 404, headers: { 'content-type': 'text/javascript' } }));
  const b = worker('b'.repeat(40), [next]); await b.install(); await b.activate(); network.mockClear();
  expect(await (await b.fetch(old)).text()).toBe('module:' + old);
  expect(await (await b.fetch(next)).text()).toBe('NEW_MODULE');
  expect(network).not.toHaveBeenCalled(); expect(a.scope.skipWaiting).toHaveBeenCalledOnce(); expect(b.scope.clients.claim).toHaveBeenCalledOnce();
});
it.each(['/api/ledger', '/api/finance-workbench', '/api/password-reset', '/?page=finance', '/index.html', '/assets/main-oldAAAAA.js?token=private', 'https://external.test/assets/main-oldAAAAA.js', '/assets/customer.json', '/assets/avatar.png'])('never intercepts or caches non-static business/auth/document requests: %s', async path => {
  const sw = worker('a'.repeat(40), []); expect(await sw.fetch(path)).toBeNull(); expect(network).not.toHaveBeenCalled(); expect(stores.size).toBe(0);
});
it('ignores POST even to an asset-shaped URL', async () => { expect(await worker('a'.repeat(40), []).fetch('/assets/main-oldAAAAA.js', 'POST')).toBeNull(); });
it('rejects HTML fallback and redirects from the static cache and preserves an existing release', async () => {
  const path = '/assets/main-oldAAAAA.js'; await worker('a'.repeat(40), [path]).install();
  network.mockResolvedValue(new Response('<html>new shell</html>', { headers: { 'content-type': 'text/html' } }));
  const b = worker('b'.repeat(40), ['/assets/missing-newBBBBB.js']); await b.install();
  expect(await (await b.fetch(path)).text()).toBe('module:' + path);
  expect([...stores.get('sweater-ui-static-v1-' + 'b'.repeat(40)).keys()]).toEqual([]);
});
it('keeps navigation possible when CacheStorage is blocked and never caches the network fallback', async () => {
  cacheStorage.keys = async () => { throw new Error('quota'); };
  const sw = worker('a'.repeat(40), []); expect(await (await sw.fetch('/assets/main-oldAAAAA.js')).text()).toContain('module:'); expect(network).toHaveBeenCalledOnce();
});
it('does not delete unrelated caches and retains at most five completed releases', async () => {
  stores.set('private-business-cache-not-ours', new Map([['private', new Response('private')]]));
  let clock = Date.now(); const time = vi.spyOn(Date, 'now').mockImplementation(() => clock);
  for (let i = 0; i < 7; i++) { clock += 1000; await worker(String(i).repeat(40), ['/assets/main-buildAAA' + i + '.js']).install(); }
  expect([...stores.keys()].filter(s => s.startsWith('sweater-ui-static-v1-'))).toHaveLength(5);
  expect(stores.has('private-business-cache-not-ours')).toBe(true);
  clock += 73 * 60 * 60 * 1000; await worker('f'.repeat(40), ['/assets/main-latestAAA.js']).install();
  expect([...stores.keys()].filter(s => s.startsWith('sweater-ui-static-v1-'))).toEqual(['sweater-ui-static-v1-' + 'f'.repeat(40)]); time.mockRestore();
});
it('does not navigate/reload clients and warms only approved immutable paths', async () => {
  const sw = worker('a'.repeat(40), ['/api/ledger']); await sw.install(); await sw.activate(); expect(network).not.toHaveBeenCalled(); expect(sw.scope.clients).toEqual({ claim: expect.any(Function) });
});
it('emits a versioned worker from actual generated JS/CSS only and rejects an unbounded budget', () => {
  const emitFile = vi.fn(); const error = message => { throw new Error(message); };
  const plugin = staticAssetsPlugin('a'.repeat(40));
  plugin.generateBundle.call({ emitFile, error }, {}, { 'assets/main-oldAAAAA.js': { code: 'source' }, 'assets/page-oldAAAAA.css': { source: 'style' }, 'index.html': { source: 'private' }, 'assets/main-oldAAAAA.js.map': { source: 'map' } });
  const emitted = emitFile.mock.calls[0][0]; expect(emitted.fileName).toBe('sw.js'); expect(emitted.source).toContain('a'.repeat(40)); expect(emitted.source).toContain('/assets/main-oldAAAAA.js'); expect(emitted.source).not.toContain('"index.html"'); expect(emitted.source).not.toContain('.js.map');
  expect(() => plugin.generateBundle.call({ emitFile, error }, {}, { 'assets/main-oldAAAAA.js': { code: 'x'.repeat(32 * 1024 * 1024 + 1) } })).toThrow(/budget/);
});
