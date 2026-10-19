/* Generated per release. Cache only immutable UI code, NEVER HTML, APIs or user data. */
const BUILD = '__SW_BUILD__';
const ASSETS = '__SW_ASSETS__';
const PREFIX = 'sweater-ui-static-v1-';
const CACHE = PREFIX + BUILD;
const META = new URL('/__sweater_static_meta__', self.location.origin).href;
const MAX_BUILDS = 5;
const MAX_AGE = 72 * 60 * 60 * 1000;

function assetPath(request) {
  if (request.method !== 'GET') return null;
  const url = new URL(request.url, self.location.origin);
  return url.origin === self.location.origin && !url.search && /^\/assets\/[A-Za-z0-9_-]+-[A-Za-z0-9_-]{6,}\.(?:js|css)$/.test(url.pathname) ? url.pathname : null;
}
function validResponse(response, path) {
  const type = response.headers.get('content-type') || '';
  return response.status === 200 && !response.redirected && (path.endsWith('.js') ? /(?:javascript|ecmascript)/i.test(type) : /^text\/css\b/i.test(type));
}
async function prune() {
  const names = (await caches.keys()).filter(name => name.startsWith(PREFIX));
  const old = [];
  for (const name of names) {
    if (name === CACHE) continue;
    const meta = await (await caches.open(name)).match(META);
    let at = 0;
    try { at = (await meta?.json())?.at || 0; } catch { /* Unknown/partial cache is expendable static code only. */ }
    old.push({ name, at });
  }
  old.sort((a, b) => b.at - a.at);
  await Promise.all(old.filter((item, i) => i >= MAX_BUILDS - 1 || Date.now() - item.at > MAX_AGE).map(item => caches.delete(item.name)));
}
async function warm() {
  if (!Array.isArray(ASSETS) || !ASSETS.length || ASSETS.length > 600) return;
  const cache = await caches.open(CACHE);
  let next = 0;
  // Starts after the loaded app registers its worker. Low-priority, four at a
  // time; fetch source files only, never execute modules or query business APIs.
  async function worker() {
    while (next < ASSETS.length) {
      const path = ASSETS[next++];
      const request = new Request(new URL(path, self.location.origin));
      if (!assetPath(request)) throw new Error('invalid-static-path');
      if (await cache.match(request)) continue;
      const response = await fetch(request, { cache: 'force-cache', priority: 'low' });
      if (!validResponse(response, path)) throw new Error('static-unavailable');
      await cache.put(request, response);
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, ASSETS.length) }, worker));
  await cache.put(META, new Response(JSON.stringify({ at: Date.now(), build: BUILD }), { headers: { 'content-type': 'application/json' } }));
  await prune(); // Retain previous releases only after this release is complete.
}
async function serve(request) {
  const names = (await caches.keys()).filter(name => name.startsWith(PREFIX));
  for (const name of names) {
    const response = await (await caches.open(name)).match(request);
    if (response && validResponse(response, new URL(request.url).pathname)) return response;
  }
  return fetch(request); // Missing/expired assets fail normally; never substitute new code or HTML.
}
self.addEventListener('install', event => {
  event.waitUntil(warm().catch(() => { /* Offline/quota: preserve old cache; do not break or reload a page. */ }).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', event => {
  if (!assetPath(event.request)) return; // No interception/caching of HTML, API, auth, media, or cross-origin traffic.
  event.respondWith(serve(event.request).catch(() => fetch(event.request)));
});
