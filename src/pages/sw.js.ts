import type { APIRoute } from 'astro';

// SSR-spike: emit /sw.js as a static asset under output:'server'.
export const prerender = true;

// T1.5.B7 — VERSION must change every deploy or stale `/_astro/[hash].js`
// references survive in cache and 504-loop the page. The token is replaced
// with the build ID at SSG time (see astro.config.ts).
const BUILD_ID = import.meta.env.PUBLIC_BUILD_ID || String(Date.now());

const SW_SOURCE = String.raw`/* eslint-disable */
// Etus Service Worker — TECH_DEBT 1.7.
// Two jobs:
// 1) Cache static assets (HTML SWR, hashed _astro/* cache-first, well-known
//    icons/logos cache-first, other images SWR).
// 2) Durably queue POSTs to /v1/e — the events-api ingestion endpoint —
//    on network failure. Matches by URL path so cross-origin requests to the
//    worker (events.<tenant>.com) are caught the same as same-origin ones.
//    Retries via BackgroundSync flush-events tag when connectivity returns.
//    Brief requirement: lead capturado nunca pode se perder.

const VERSION = '__BUILD_ID__';
const HTML_CACHE = VERSION + '-html';
const ASSET_CACHE = VERSION + '-asset';

self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    const allKeys = await caches.keys();
    await Promise.all(
      allKeys
        .filter(function (k) { return !k.startsWith(VERSION); })
        .map(function (k) { return caches.delete(k); })
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', function (event) {
  const req = event.request;
  const url = new URL(req.url);

  // Queueable analytics POSTs. SAME-ORIGIN ONLY — prod has /v1/e wired via
  // Worker Routes per tenant zone (T0.1). Cross-origin (dev only) bypasses
  // the SW so we don't accumulate retries against an unreachable localhost
  // worker. Cookies (T0.5 _etus_aid) only work same-origin anyway.
  if (
    req.method === 'POST' &&
    url.origin === self.location.origin &&
    url.pathname.endsWith('/v1/e')
  ) {
    event.respondWith(handleQueueablePost(req.clone()));
    return;
  }

  // From here on, same-origin GETs only — cache strategies.
  if (url.origin !== self.location.origin) return;
  if (req.method !== 'GET') return;

  if (url.pathname.startsWith('/_astro/')) {
    event.respondWith(cacheFirst(req, ASSET_CACHE));
    return;
  }
  // Well-known top-level static assets (favicon, apple-touch, og, logo).
  // These rarely change between deploys; treat them as immutable per SW version
  // to avoid revalidation traffic on every navigation. SW VERSION bump on
  // deploy clears the cache.
  if (/^\/(favicon\.[a-z]+|apple-touch-icon\.[a-z]+|mask-icon\.[a-z]+|og-default\.[a-z]+|logo\.[a-z]+)$/i.test(url.pathname)) {
    event.respondWith(cacheFirst(req, ASSET_CACHE));
    return;
  }
  if (/\.(png|jpe?g|webp|avif|svg|ico|woff2?|ttf|otf|gif)$/i.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(req, ASSET_CACHE));
    return;
  }
  const accept = req.headers.get('accept') || '';
  if (req.mode === 'navigate' || accept.indexOf('text/html') !== -1) {
    // T1.1 — HTML uses network-first with 2s timeout. SWR was a footgun
    // post-deploy: stale HTML referencing dead /_astro/[hash].js paths.
    event.respondWith(networkFirstWithTimeout(req, HTML_CACHE, 2000));
    return;
  }
});

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (_) {
    return new Response('', { status: 504 });
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const fetchP = fetch(req)
    .then(function (res) {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(function () { return null; });
  return cached || (await fetchP) || new Response('', { status: 504 });
}

// Network-first with timeout: try network within timeoutMs; fall back to cache
// if network is slow/fails. After successful network response, refresh cache.
// Used for HTML so post-deploy users don't see stale references.
// T1.5.B7 — never cache prefetched HTML: sec-purpose=prefetch is speculative
// and the user may never navigate there. Caching it warms a stale entry and,
// post-deploy, can return HTML pointing at /_astro/[old-hash].js.
async function networkFirstWithTimeout(req, cacheName, timeoutMs) {
  const cache = await caches.open(cacheName);
  const isPrefetch = (req.headers.get('sec-purpose') || '').indexOf('prefetch') !== -1
    || (req.headers.get('purpose') || '').indexOf('prefetch') !== -1;
  let timer;
  const timeout = new Promise(function (resolve) {
    timer = setTimeout(function () { resolve(null); }, timeoutMs);
  });
  const networkP = fetch(req).then(function (res) {
    if (res && res.ok && !isPrefetch) cache.put(req, res.clone());
    return res;
  }).catch(function () { return null; });
  // Race network vs timeout. If timeout wins, return cache while network completes in background.
  const winner = await Promise.race([networkP, timeout]);
  clearTimeout(timer);
  if (winner) return winner;
  const cached = await cache.match(req);
  if (cached) return cached;
  // No cache — wait for network anyway (we already started it).
  return (await networkP) || new Response('', { status: 504 });
}

// ---------- Queue (POST /v1/e) ----------

const QUEUE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h — older entries are evicted on enqueue
const QUEUE_MAX_ENTRIES = 500;                 // hard cap; LRU evict oldest
const QUEUE_MAX_ATTEMPTS = 5;                  // drop after N failed replays — defense in depth

let _flushing = false;                          // serialize concurrent sync+message drains

self.addEventListener('sync', function (event) {
  if (event.tag === 'flush-events') event.waitUntil(flushQueue());
});

self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'flush-events') flushQueue();
});

async function handleQueueablePost(req) {
  // fetch() consumes req.body. Clone BEFORE the network call so we can still
  // read the body in enqueue() if the fetch fails.
  const queueCopy = req.clone();
  try {
    const res = await fetch(req);
    // Treat 5xx as failure too — server is alive but unhappy, retry later.
    if (!res || (res.status >= 500 && res.status < 600)) throw new Error('upstream ' + (res && res.status));
    return res;
  } catch (_) {
    // T1.5.B6 — distinguish enqueue success from failure. Safari private mode
    // and QuotaExceeded both raise here; the previous code swallowed the
    // error and returned 202 {queued:true}, so the client thought the event
    // landed when it had vanished. Now we return 503 {queued:false} on
    // failure so the client can retain in-memory and try again.
    var enqueued = false;
    try {
      await enqueue(queueCopy);
      enqueued = true;
      if (self.registration && self.registration.sync) {
        await self.registration.sync.register('flush-events');
      }
    } catch (_) {}
    if (!enqueued) {
      return new Response(JSON.stringify({ queued: false, error: 'enqueue_failed' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ queued: true }), {
      status: 202,
      headers: { 'content-type': 'application/json' },
    });
  }
}

async function enqueue(req) {
  const body = await req.text();
  const entry = {
    url: req.url,
    method: req.method,
    headers: Array.from(req.headers.entries()),
    body: body,
    queuedAt: Date.now(),
    attempts: 0,
  };
  const db = await openDB();

  // T1.6: evict expired (>24h) AND oldest (LRU) when cap exceeded BEFORE adding.
  // Prevents IDB quota blow-up if worker is permanently down.
  await evictExpiredAndOverflow(db);

  await new Promise(function (resolve, reject) {
    const tx = db.transaction('events', 'readwrite');
    const r = tx.objectStore('events').add(entry);
    r.onsuccess = function () { resolve(); };
    r.onerror = function () { reject(r.error); };
  });
}

// T1.5.H6 — single readwrite transaction. The previous implementation issued
// one getAll + one delete-per-entry across SEPARATE transactions. Under
// flaky-network bursts, an enqueue() could land between the getAll and the
// deletes, so the queue would temporarily exceed cap. Cursor iteration inside
// one tx is atomic w.r.t. other tx and is the supported IDB pattern for
// bulk-and-delete.
function evictExpiredAndOverflow(db) {
  return new Promise(function (resolve, reject) {
    const tx = db.transaction('events', 'readwrite');
    const store = tx.objectStore('events');
    const now = Date.now();
    // First pass: walk the store in insertion order (auto-increment id), drop
    // expired inline. Collect surviving { id, queuedAt } refs so we can pick
    // overflow victims without a second store walk.
    const survivors = [];
    const cursorReq = store.openCursor();
    cursorReq.onsuccess = function () {
      const cursor = cursorReq.result;
      if (cursor) {
        const entry = cursor.value;
        if (now - (entry.queuedAt || 0) > QUEUE_MAX_AGE_MS) {
          cursor.delete();
        } else {
          survivors.push({ id: entry.id, queuedAt: entry.queuedAt || 0 });
        }
        cursor.continue();
        return;
      }
      // Cursor done — check overflow. The store auto-assigns ids monotonically,
      // so insertion order ≈ queuedAt order; we still sort defensively in case
      // a future migration backfills queuedAt out-of-order.
      if (survivors.length >= QUEUE_MAX_ENTRIES) {
        const sorted = survivors.slice().sort(function (a, b) {
          return a.queuedAt - b.queuedAt;
        });
        const dropCount = sorted.length - QUEUE_MAX_ENTRIES + 1;
        for (let i = 0; i < dropCount; i++) {
          store.delete(sorted[i].id);
        }
      }
    };
    cursorReq.onerror = function () { reject(cursorReq.error); };
    tx.oncomplete = function () { resolve(); };
    tx.onerror = function () { reject(tx.error); };
    tx.onabort = function () { reject(tx.error || new Error('eviction tx aborted')); };
  });
}

async function flushQueue() {
  // T1.6: serialize concurrent invocations (sync + message + online listener).
  if (_flushing) return;
  _flushing = true;
  let transientFailure = false;
  try {
    const db = await openDB();
    // Evict expired/overflow before flushing to avoid wasting bandwidth on stale.
    await evictExpiredAndOverflow(db);
    const all = await idbGetAll(db, 'events');
    for (const entry of all) {
      try {
        const res = await fetch(entry.url, {
          method: entry.method,
          headers: new Headers(entry.headers),
          body: entry.body,
        });
        if (res && res.ok) {
          await idbDelete(db, 'events', entry.id);
        } else if (res && res.status === 401) {
          // T2.27 — don't drop on 401. The write key may have rotated mid-
          // queue; notify any controlled client so it can refresh the boot
          // config and the next flush has a chance with the new key.
          try {
            var clients = await self.clients.matchAll({ includeUncontrolled: false });
            for (var ci = 0; ci < clients.length; ci++) {
              clients[ci].postMessage({ type: 'etus:write-key-stale' });
            }
          } catch (_) {}
          // Hold the entry; treat as transient. bumpAttemptOrDrop will GC if
          // a stale key persists past QUEUE_MAX_ATTEMPTS replays.
          await bumpAttemptOrDrop(db, entry);
          transientFailure = true;
          break;
        } else if (res && res.status >= 400 && res.status < 500) {
          // 4xx is permanent — drop so we don't loop forever (validation, 422 anti-fraud).
          await idbDelete(db, 'events', entry.id);
        } else {
          // 5xx or no response — bump attempts. Drop entry if cap exceeded
          // (defense in depth: prevents permanent IDB residue if endpoint
          // misbehaves long-term). Otherwise stop draining; re-register sync.
          await bumpAttemptOrDrop(db, entry);
          transientFailure = true;
          break;
        }
      } catch (_) {
        await bumpAttemptOrDrop(db, entry);
        transientFailure = true;
        break;
      }
    }
  } finally {
    _flushing = false;
  }
  // Re-register sync on transient failure so BackgroundSync retries when
  // connectivity recovers. Safari ignores (no sync support); the message+online
  // path covers that case.
  if (transientFailure) {
    try {
      if (self.registration && self.registration.sync) {
        await self.registration.sync.register('flush-events');
      }
    } catch (_) {}
  }
}

async function bumpAttemptOrDrop(db, entry) {
  const attempts = (entry.attempts || 0) + 1;
  if (attempts >= QUEUE_MAX_ATTEMPTS) {
    await idbDelete(db, 'events', entry.id);
    return;
  }
  entry.attempts = attempts;
  await idbPut(db, 'events', entry);
}

// IDB helpers (Promise-wrapped)
function idbPut(db, store, value) {
  return new Promise(function (resolve, reject) {
    const tx = db.transaction(store, 'readwrite');
    const r = tx.objectStore(store).put(value);
    r.onsuccess = function () { resolve(); };
    r.onerror = function () { reject(r.error); };
  });
}
function idbGetAll(db, store) {
  return new Promise(function (resolve, reject) {
    const tx = db.transaction(store, 'readonly');
    const r = tx.objectStore(store).getAll();
    r.onsuccess = function () { resolve(r.result || []); };
    r.onerror = function () { reject(r.error); };
  });
}
function idbDelete(db, store, key) {
  return new Promise(function (resolve, reject) {
    const tx = db.transaction(store, 'readwrite');
    const r = tx.objectStore(store).delete(key);
    r.onsuccess = function () { resolve(); };
    r.onerror = function () { reject(r.error); };
  });
}

// T1.5.H5 — Bump this when adding/altering object stores. onupgradeneeded
// inspects oldVersion so each migration step is additive and idempotent.
const IDB_VERSION = 1;

let _db = null;
function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise(function (resolve, reject) {
    const r = indexedDB.open('etus-queue', IDB_VERSION);
    r.onupgradeneeded = function (event) {
      const db = r.result;
      const oldVersion = (event && event.oldVersion) || 0;
      // Scaffold for future migrations — keep each step guarded so a client
      // jumping multiple versions runs them all in order. Today only v1 exists.
      if (oldVersion < 1) {
        if (!db.objectStoreNames.contains('events')) {
          db.createObjectStore('events', { keyPath: 'id', autoIncrement: true });
        }
      }
      // Future: if (oldVersion < 2) { /* new migration step */ }
    };
    r.onsuccess = function () {
      _db = r.result;
      // T1.5.H5 — close + null the handle when another tab triggers a version
      // change. Without this, the old open connection blocks the upgrade and
      // the new tab deadlocks on onblocked indefinitely.
      _db.onversionchange = function () {
        try { _db && _db.close(); } catch (_) {}
        _db = null;
      };
      _db.onclose = function () { _db = null; };
      resolve(_db);
    };
    r.onerror = function () { reject(r.error); };
    r.onblocked = function () {
      // Another tab holds an older version open. Surface in logs so flaky
      // upgrades are debuggable; the open will retry on next call.
      console.warn('IDB upgrade blocked by another open connection');
    };
  });
}
`;

// DEV: a self-destruct SW. Registering the caching SW on localhost caused a
// removal DEADLOCK — the stale SW served stale (old) HTML that lacked the
// unregister script, so it never died. The SW UPDATE path re-fetches /sw.js for
// the existing registration independent of page HTML; serving this stub makes the
// browser install it, then on activate it nukes all caches, unregisters itself,
// and reloads controlled tabs. One navigation after this ships → SW is gone.
const DEV_SW_SOURCE = String.raw`/* eslint-disable */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    try {
      var keys = await caches.keys();
      await Promise.all(keys.map(function (k) { return caches.delete(k); }));
    } catch (_) {}
    try { await self.registration.unregister(); } catch (_) {}
    try {
      var clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach(function (c) { try { c.navigate(c.url); } catch (_) {} });
    } catch (_) {}
  })());
});
`;

export const GET: APIRoute = () =>
  new Response(
    import.meta.env.DEV ? DEV_SW_SOURCE : SW_SOURCE.replace('__BUILD_ID__', 'etus-' + BUILD_ID),
    {
      headers: {
        'content-type': 'application/javascript; charset=utf-8',
        // Dev: never let the browser cache the SW script itself, so the
        // self-destruct update is always picked up.
        'cache-control': import.meta.env.DEV ? 'no-store' : 'public, max-age=0, must-revalidate',
        'service-worker-allowed': '/',
      },
    },
  );
