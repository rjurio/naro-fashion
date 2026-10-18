/* eslint-disable */
/**
 * Naro Admin service worker — offline shell (Phase 1).
 *
 * Strategy:
 *  - /_next/static/*, fonts, images in /public, /uploads images  → cache-first
 *  - same-origin navigations + Next RSC/flight requests          → network-first,
 *    successful responses stored, cached copy used when the network fails
 *    (RSC keyed on the full URL incl. `_rsc`; a miss returns a network error so
 *    the Next router falls back to a full navigation, which IS cached).
 *  - Uncached navigation while offline → cached /offline page (or an inline fallback).
 *  - NEVER: cross-origin requests (the API — its data is cached per user in
 *    IndexedDB by the client), non-GET requests, redirected responses.
 *
 * Bump VERSION to drop every old cache on the next activation.
 * Served with `Cache-Control: no-cache` (next.config.js) so updates are picked up.
 */
const VERSION = 'v1';
const PREFIX = 'naro-admin-';
const STATIC_CACHE = PREFIX + 'static-' + VERSION;
const PAGE_CACHE = PREFIX + 'pages-' + VERSION;
const RSC_CACHE = PREFIX + 'rsc-' + VERSION;
const IMAGE_CACHE = PREFIX + 'images-' + VERSION;
const CURRENT_CACHES = [STATIC_CACHE, PAGE_CACHE, RSC_CACHE, IMAGE_CACHE];

const OFFLINE_URL = '/offline';
const NETWORK_TIMEOUT_MS = 8000;
const MAX_ENTRIES = { [STATIC_CACHE]: 600, [PAGE_CACHE]: 120, [RSC_CACHE]: 200, [IMAGE_CACHE]: 400 };

const STATIC_EXT = /\.(?:js|css|woff2?|ttf|otf|eot)$/i;
const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp|avif|svg|ico)$/i;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      try {
        await warmPages([OFFLINE_URL]);
      } catch (e) {
        /* offline during install — the fallback page is cached on first visit instead */
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith(PREFIX) && !CURRENT_CACHES.includes(k)).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'WARM' && Array.isArray(data.urls)) {
    event.waitUntil(warmPages(data.urls).catch(() => undefined));
  } else if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // never cache writes (incl. login POSTs)

  let url;
  try {
    url = new URL(req.url);
  } catch (e) {
    return;
  }
  if (url.origin !== self.location.origin) return; // API + any third party: straight to network
  if (url.pathname === '/sw.js') return;
  if (url.pathname.startsWith('/_next/webpack-hmr') || url.pathname.startsWith('/__nextjs')) return;
  if (req.headers.get('range')) return; // media range requests

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(req, STATIC_CACHE));
    return;
  }
  if (url.pathname.startsWith('/_next/image')) {
    event.respondWith(cacheFirst(req, IMAGE_CACHE));
    return;
  }

  const isRsc = req.headers.get('RSC') === '1' || url.searchParams.has('_rsc');
  if (isRsc) {
    event.respondWith(networkFirstRsc(req));
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith(networkFirstPage(req, url));
    return;
  }

  // /public assets + /uploads images (rewritten to the API, same-origin here).
  if (IMAGE_EXT.test(url.pathname)) {
    event.respondWith(cacheFirst(req, IMAGE_CACHE));
    return;
  }
  if (STATIC_EXT.test(url.pathname) || url.pathname === '/manifest.webmanifest') {
    event.respondWith(cacheFirst(req, STATIC_CACHE));
  }
  // Anything else: default browser handling.
});

function cacheable(res) {
  return res && res.ok && res.status === 200 && !res.redirected && (res.type === 'basic' || res.type === 'default');
}

async function putTrimmed(cacheName, request, response) {
  try {
    const cache = await caches.open(cacheName);
    await cache.put(request, response);
    const max = MAX_ENTRIES[cacheName];
    if (max) {
      const keys = await cache.keys();
      // Cache.keys() is insertion-ordered → delete the oldest.
      for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
    }
  } catch (e) {
    /* quota exceeded etc. — caching is best-effort */
  }
}

async function cacheFirst(req, cacheName) {
  const cached = await caches.match(req, { cacheName, ignoreVary: true });
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (cacheable(res)) putTrimmed(cacheName, req, res.clone());
    return res;
  } catch (e) {
    return Response.error();
  }
}

/** fetch with a timeout that only resolves to null on timeout (the fetch keeps running). */
function fetchWithTimeout(req) {
  const network = fetch(req);
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NETWORK_TIMEOUT_MS));
  return { network, raced: Promise.race([network, timeout]) };
}

async function networkFirstPage(req, url) {
  const { network, raced } = fetchWithTimeout(req);
  try {
    const res = await raced;
    if (res) {
      if (cacheable(res)) putTrimmed(PAGE_CACHE, url.pathname + url.search, res.clone());
      return res;
    }
  } catch (e) {
    /* network error → fall through to cache */
  }

  const cached =
    (await caches.match(url.pathname + url.search, { cacheName: PAGE_CACHE, ignoreVary: true })) ||
    (await caches.match(url.pathname, { cacheName: PAGE_CACHE, ignoreVary: true, ignoreSearch: true })) ||
    (url.pathname === '/' ? await caches.match('/dashboard', { cacheName: PAGE_CACHE, ignoreVary: true }) : undefined);
  if (cached) return cached;

  // Timed out with nothing cached: keep waiting for the (slow) network.
  try {
    const res = await network;
    if (cacheable(res)) putTrimmed(PAGE_CACHE, url.pathname + url.search, res.clone());
    return res;
  } catch (e) {
    /* offline and uncached */
  }
  const offline = await caches.match(OFFLINE_URL, { cacheName: PAGE_CACHE, ignoreVary: true });
  return offline || inlineOfflineResponse();
}

async function networkFirstRsc(req) {
  const { network, raced } = fetchWithTimeout(req);
  try {
    const res = await raced;
    if (res) {
      if (cacheable(res)) putTrimmed(RSC_CACHE, req.url, res.clone());
      return res;
    }
  } catch (e) {
    /* fall through */
  }
  const cached = await caches.match(req.url, { cacheName: RSC_CACHE, ignoreVary: true });
  if (cached) return cached;
  try {
    const res = await network;
    if (cacheable(res)) putTrimmed(RSC_CACHE, req.url, res.clone());
    return res;
  } catch (e) {
    // A failed flight fetch makes the Next router do a full navigation,
    // which networkFirstPage answers from the page cache.
    return Response.error();
  }
}

/**
 * Fetch pages and store them, plus the /_next/static assets they reference
 * (so a warmed page actually boots offline). Only same-origin paths.
 */
async function warmPages(urls) {
  const pages = await caches.open(PAGE_CACHE);
  const assets = new Set();
  for (const raw of urls) {
    let u;
    try {
      u = new URL(raw, self.location.origin);
    } catch (e) {
      continue;
    }
    if (u.origin !== self.location.origin) continue;
    try {
      const res = await fetch(u.pathname + u.search, { credentials: 'same-origin', cache: 'no-store' });
      if (!cacheable(res)) continue;
      const html = await res.clone().text();
      await pages.put(u.pathname + u.search, res);
      collectAssets(html, assets);
    } catch (e) {
      /* skip this page */
    }
  }
  if (assets.size) {
    const staticCache = await caches.open(STATIC_CACHE);
    for (const path of assets) {
      try {
        if (await staticCache.match(path)) continue;
        const res = await fetch(path, { credentials: 'same-origin' });
        if (cacheable(res)) await staticCache.put(path, res);
      } catch (e) {
        /* best effort */
      }
    }
  }
  // Trim the page cache after a warm burst.
  try {
    const keys = await pages.keys();
    for (let i = 0; i < keys.length - MAX_ENTRIES[PAGE_CACHE]; i++) await pages.delete(keys[i]);
  } catch (e) {
    /* ignore */
  }
}

function collectAssets(html, into) {
  // <script src="/_next/static/..."> / <link href="/_next/static/...">
  const direct = html.match(/\/_next\/static\/[^"'\s\\)<>]+/g) || [];
  // Chunk paths inside the inline RSC payload: "static/chunks/app/....js"
  const flight = html.match(/static\/(?:chunks|css|media)\/[^"'\s\\)<>]+/g) || [];
  for (const p of direct) into.add(p);
  for (const p of flight) into.add('/_next/' + p);
}

function inlineOfflineResponse() {
  const body =
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Offline · Naro Admin</title>' +
    '<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;' +
    'font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#1A1A1A;color:#f5f5f5;padding:16px}' +
    '.c{max-width:420px;text-align:center}h1{color:#D4AF37;font-size:22px;margin:0 0 8px}' +
    'p{color:#bdbdbd;font-size:14px;line-height:1.5}a{display:inline-block;margin-top:16px;padding:10px 18px;' +
    'border-radius:8px;background:#D4AF37;color:#1A1A1A;text-decoration:none;font-weight:600;font-size:14px}</style>' +
    '</head><body><div class="c"><h1>You’re offline</h1>' +
    '<p>This page hasn’t been saved on this device yet. Pages you have opened before still work offline.</p>' +
    '<a href="/dashboard">Go to dashboard</a></div></body></html>';
  return new Response(body, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
