/* FXC Field — service worker
 *
 * Strategy:
 *   - SHELL (the static app files): cache-first, so the PWA launches instantly
 *     and works offline. Bump CACHE_VERSION on every deploy to roll the cache.
 *   - GitHub REST API (api.github.com): NEVER cached. Those responses carry the
 *     per-device PAT in the request and are live job truth — always hit network.
 *     data.js owns the read-only offline snapshot (localStorage "fxc.cache.jobs"),
 *     not the SW. The SW only refuses to touch GitHub traffic.
 *   - Other GET requests (same-origin assets we didn't pre-list, e.g. an icon
 *     variant): cache-first with a network fallback that fills the cache lazily.
 *
 * No build step: this is a plain static file referenced by FXC.boot()'s
 * navigator.serviceWorker.register('./sw.js').
 */

'use strict';

// Bump this string on every deploy so clients drop the old shell cache.
const CACHE_VERSION = 'v9';
const CACHE_NAME = 'fxc-shell-' + CACHE_VERSION;

// The complete app shell (relative to the SW scope = the folder it ships in).
// Keep this in sync with the files referenced by index.html.
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

// ---- install: pre-cache the shell -----------------------------------------
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

// ---- activate: drop stale caches, take control -----------------------------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((n) => n.startsWith('fxc-shell-') && n !== CACHE_NAME)
          .map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

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

  // Navigation requests (the page itself): serve the cached app shell first so
  // the PWA opens offline; refresh the cached copy in the background when online.
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then((cached) => {
        const network = fetch(req)
          .then((res) => {
            if (res && res.ok) {
              const copy = res.clone();
              caches.open(CACHE_NAME).then((c) => c.put('./index.html', copy));
            }
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // Same-origin assets: cache-first, then network (and lazily cache the result).
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req)
          .then((res) => {
            if (res && res.ok && res.type === 'basic') {
              const copy = res.clone();
              caches.open(CACHE_NAME).then((c) => c.put(req, copy));
            }
            return res;
          })
          .catch(() => cached); // nothing cached + offline -> undefined (browser error)
      })
    );
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
