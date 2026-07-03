/* FXC Field — service worker
 *
 * Strategy (network-first, 2026-07-03 — the CACHE_VERSION ritual is deleted):
 *   - SHELL (navigations + same-origin asset GETs): NETWORK-FIRST with a short
 *     timeout. Online phones always run the pushed code — no version to bump,
 *     no deploy ritual, never a shell behind. Every fresh response refills one
 *     unversioned cache ("fxc-shell"); on timeout/offline the cached copy
 *     serves, so the PWA still opens with no signal.
 *   - GitHub REST API (api.github.com): NEVER cached. Those responses carry the
 *     per-device PAT in the request and are live job truth — always hit network.
 *     data.js owns the read-only offline snapshot (localStorage "fxc.cache.jobs"),
 *     not the SW. The SW only refuses to touch GitHub traffic.
 *
 * No build step: this is a plain static file referenced by FXC.boot()'s
 * navigator.serviceWorker.register('./sw.js').
 */

'use strict';

const CACHE_NAME = 'fxc-shell'; // unversioned — network-first keeps it fresh

// How long a fetch may run before the cached copy serves instead (the fetch
// still completes in the background and refills the cache for next time).
const NETWORK_TIMEOUT_MS = 2500;

// The complete app shell (relative to the SW scope = the folder it ships in).
// Keep this in sync with the files referenced by index.html — the harness
// tripwire (tests/shell-assets.test.js) goes red on drift.
const SHELL_ASSETS = [
  './',
  './index.html',
  './config.js',
  './data.js',
  './card.js',
  './demo-jobs.js',
  './identity.js',
  './edit.js',
  './app-glue.js',
  './manifest.webmanifest',
  './team.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png'
];

// Hosts whose responses must NEVER be cached (live, token-bearing API traffic).
function isGitHubApi(url) {
  return url.hostname === 'api.github.com' ||
         url.hostname === 'raw.githubusercontent.com' ||
         url.hostname.endsWith('.githubusercontent.com');
}

// ---- install: pre-cache the shell (first-launch offline still works) --------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      // Activate the new SW immediately rather than waiting for all tabs to close.
      .then(() => self.skipWaiting())
      // A single missing/renamed asset must not abort the whole install in dev;
      // fall back to caching what we can, one by one.
      .catch(() => caches.open(CACHE_NAME).then((cache) =>
        Promise.all(SHELL_ASSETS.map((a) =>
          cache.add(a).catch(() => undefined)
        ))
      ))
  );
});

// ---- activate: drop the old versioned caches (fxc-shell-v*), take control ---
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((n) => n.startsWith('fxc-shell-'))
          .map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

// ---- network-first with cache fallback --------------------------------------
// cacheKey lets every navigation URL (/, /?demo=1, /#card=2813) share the one
// cached './index.html' entry instead of fragmenting the fallback per-URL.
function networkFirst(req, cacheKey) {
  const key = cacheKey || req;
  return caches.open(CACHE_NAME).then((cache) =>
    cache.match(key).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.ok) cache.put(key, res.clone());
        return res;
      });
      const timer = new Promise((resolve) => {
        setTimeout(() => resolve(null), NETWORK_TIMEOUT_MS);
      });
      return Promise.race([network.catch(() => null), timer]).then((res) => {
        if (res) return res;      // fresh (or a real HTTP error — let the page see it)
        if (cached) return cached; // slow/offline → the cached shell serves
        return network;            // nothing cached: wait the network out
      });
    })
  );
}

// ---- fetch: route by destination -------------------------------------------
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only ever handle GETs. Writes (PUT/DELETE to GitHub) and any non-GET pass
  // straight through, untouched.
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch (_e) {
    return; // opaque/invalid URL — let the browser handle it
  }

  // GitHub API: never cache, never read from cache. Pure passthrough.
  // (If offline, this rejects and data.js falls back to its localStorage snapshot.)
  if (isGitHubApi(url)) {
    return; // do not call respondWith -> default network behaviour
  }

  // Navigation requests (the page itself): network-first so an online phone
  // always gets the deployed shell; the cached copy serves offline.
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req, './index.html'));
    return;
  }

  // Same-origin assets: network-first too — one reload = current code.
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req));
    return;
  }

  // Anything else cross-origin (fonts, etc.): try network, fall back to cache.
  event.respondWith(
    fetch(req).catch(() => caches.match(req))
  );
});

// ---- messaging: let the page trigger an immediate activation ---------------
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting' || (event.data && event.data.type === 'skipWaiting')) {
    self.skipWaiting();
  }
});
