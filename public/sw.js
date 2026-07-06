// Minimal service worker — exists to make the dashboard installable
// (Add to Home Screen). Deliberately NO caching strategy: the app is a
// live financial tool deployed continuously on Vercel, and a stale-cache
// bug that shows yesterday's numbers is far worse than requiring a
// connection. Every request passes straight to the network.
self.addEventListener('install', () => {
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener('fetch', () => {
  // Intentionally empty: default (network) handling for every request.
});
