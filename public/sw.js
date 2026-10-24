// Offline cache: network-first for pages (always the newest build when online; a hanging connection falls back to the
// cached page after NAV_TIMEOUT_MS), cache-first for same-origin hashed assets (JS chunks, workers, fonts, icons).
// Only same-origin requests are handled: the fonts are self-hosted (public/fonts), nothing is fetched from other hosts.
// ponytail: old hashed assets stay in the cache until the version below changes; bump it to purge.
// v2: the cache of v1 held the Google Fonts stylesheet and font files (no longer used).
const CACHE = 'veilgrounds-v2';
const NAV_TIMEOUT_MS = 4000;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const put = (res) => {
    // 200 only: cache.put rejects partial (206) responses, and an error page must never replace a good copy
    if (res.status === 200) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
    }
    return res;
  };
  if (req.mode === 'navigate') {
    e.respondWith(
      new Promise((resolve) => {
        let settled = false;
        const answer = (res) => {
          if (settled || !res) return false;
          settled = true;
          resolve(res);
          return true;
        };
        const cached = () => caches.match(req).then((r) => r || caches.match('./'));
        // a connection that neither answers nor fails must not freeze the page: serve the cached copy after a while
        const timer = setTimeout(() => cached().then(answer), NAV_TIMEOUT_MS);
        fetch(req)
          .then(put)
          .then((res) => {
            clearTimeout(timer);
            answer(res);
          })
          .catch(() => {
            clearTimeout(timer);
            cached().then((r) => {
              if (!answer(r)) answer(Response.error());
            });
          });
      }),
    );
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then(put)));
});
