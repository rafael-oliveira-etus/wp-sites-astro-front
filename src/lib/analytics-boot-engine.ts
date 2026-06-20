// Tracking engine — externalized from AnalyticsBoot.astro's inline <script>.
//
// WHY this file exists: the engine body (~8 KB minified) used to be injected
// inline on EVERY page as `set:html`, paid for in raw HTML bytes on every
// request. Astro bundles a plain (non-`is:inline`) `<script>import '…'>` into
// a hashed, immutable `/_astro/*.js` module — same treatment as ClientRouter /
// WebVitals — so the engine is fetched once and cached across navigations and
// pages. Only the tiny per-page `cfg` + the synchronous stub installer stay
// inline (see AnalyticsBoot.astro + analytics-boot.body.ts BOOT_STUB).
//
// CONFIG: reads `window.__etusCfg` (set by the inline cfg script that runs
// before this module). Guards on its presence — if absent (e.g. a page that
// did not render AnalyticsBoot), the engine no-ops.
//
// TIMING / behavior preservation: this module is a DEFERRED ES module, so it
// runs after HTML parse. That is SAFE because the synchronous inline BOOT_STUB
// installs a queuing `window.etus` stub during head parse, so every early
// consumer (`if (window.etus && window.etus.track)`, `window.etus?.track`,
// PageViewTracker's initial-paint no-op) sees the same presence it always did.
// Calls made before this module boots are queued into `window.__etusQueue` and
// drained at the bottom of the IIFE — identical to the old inline drain.
//
// This file is byte-for-byte the former inline engine body (the part AFTER the
// stub), with one adaptation: `cfg` is read from `window.__etusCfg` instead of
// a lexically-prepended `const cfg`. Logic is otherwise UNCHANGED.

/* eslint-disable */
// @ts-nocheck
export {};

declare global {
  interface Window {
    __etusCfg?: Record<string, any>;
    __etusQueue?: Array<[string, any[]]> | null;
  }
}

(function () {
  if (window.etus && window.etus.__booted) return;
  var cfg = window.__etusCfg;
  if (!cfg) return;
  window.dataLayer = window.dataLayer || [];

  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    var s = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx';
    return s.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function safeLS(op, key, val) {
    try {
      if (op === 'get') return localStorage.getItem(key);
      if (op === 'set') { localStorage.setItem(key, val); return val; }
      if (op === 'remove') { localStorage.removeItem(key); return null; }
    } catch (_) { return null; }
  }

  var ANON_KEY = '_etus_aid';
  var SESSION_KEY = '_etus_session';
  var ATTR_KEY = '_etus_attr';
  var QUIZ_LIFECYCLE_KEY = 'quiz:lifecycle';

  function readCookie(name) {
    try {
      var match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
      return match ? decodeURIComponent(match[1]) : null;
    } catch (_) { return null; }
  }

  function writeCookie(name, value, maxAgeSec) {
    try {
      document.cookie = name + '=' + encodeURIComponent(value) +
        '; Max-Age=' + maxAgeSec +
        '; Path=/; SameSite=Lax' +
        (location.protocol === 'https:' ? '; Secure' : '');
    } catch (_) {}
  }

  function getOrCreateAnonymousId() {
    var cookieId = readCookie(ANON_KEY);
    var lsId = safeLS('get', ANON_KEY);
    if (cookieId) {
      if (lsId !== cookieId) safeLS('set', ANON_KEY, cookieId);
      return cookieId;
    }
    if (lsId) {
      writeCookie(ANON_KEY, lsId, 60 * 60 * 24 * 365 * 2);
      return lsId;
    }
    var fresh = uuid();
    safeLS('set', ANON_KEY, fresh);
    writeCookie(ANON_KEY, fresh, 60 * 60 * 24 * 365 * 2);
    return fresh;
  }

  function getOrRefreshSession() {
    var now = Date.now();
    var raw = safeLS('get', SESSION_KEY);
    var sess = null;
    try { sess = raw ? JSON.parse(raw) : null; } catch (_) {}
    var isNew = false;
    if (!sess || !sess.id || (now - (sess.last_activity_at || 0)) > cfg.sessionTtlMs) {
      sess = {
        id: uuid(),
        index: (sess && sess.index ? sess.index : 0) + 1,
        started_at: now,
        last_activity_at: now,
      };
      isNew = true;
    } else {
      sess.last_activity_at = now;
    }
    safeLS('set', SESSION_KEY, JSON.stringify(sess));
    return { sess: sess, isNew: isNew };
  }

  var FBC_KEY = '_fbc';
  var FBP_KEY = '_fbp';
  var META_COOKIE_TTL = 90 * 24 * 60 * 60;
  // T1.5.H8 — Meta cookie format spec: fb.<subdomain_index>.<unix_seconds>.<value>
  //   - subdomain_index = number of subdomain hops from the registrable
  //     domain. apex (example.com) = 0; www.example.com = 1; m.www.example.com = 2.
  //     Computed as max(0, hostname-parts - 2).
  //   - unix_seconds (NOT ms — the prior code emitted ms, which Meta clamps
  //     silently to the epoch boundary and degrades attribution match).
  function metaSubdomainIndex() {
    try {
      var parts = location.hostname.split('.');
      // IPv4/IPv6 literals (no dots, or only digits) → treat as apex.
      if (parts.length < 2 || /^[\d.]+$/.test(location.hostname)) return 0;
      return Math.max(0, parts.length - 2);
    } catch (_) { return 0; }
  }
  function getOrSetFbc() {
    var existing = readCookie(FBC_KEY);
    if (existing) return existing;
    var fbclid = null;
    try {
      var params = new URLSearchParams(location.search);
      fbclid = params.get('fbclid');
    } catch (_) {}
    if (!fbclid) return null;
    var fbc = 'fb.' + metaSubdomainIndex() + '.' + Math.floor(Date.now() / 1000) + '.' + fbclid;
    writeCookie(FBC_KEY, fbc, META_COOKIE_TTL);
    return fbc;
  }
  function getOrSetFbp() {
    var existing = readCookie(FBP_KEY);
    if (existing) return existing;
    var rand = Math.floor(Math.random() * 9000000000) + 1000000000;
    var fbp = 'fb.' + metaSubdomainIndex() + '.' + Math.floor(Date.now() / 1000) + '.' + rand;
    writeCookie(FBP_KEY, fbp, META_COOKIE_TTL);
    return fbp;
  }

  function captureAttribution() {
    var params;
    try { params = new URLSearchParams(location.search); } catch (_) { params = null; }
    var keys = [
      'utm_source','utm_medium','utm_campaign','utm_content','utm_term',
      'gclid','fbclid','ttclid','msclkid','wbraid','gbraid','irclickid'
    ];
    var fresh = {};
    if (params) {
      for (var i = 0; i < keys.length; i++) {
        var v = params.get(keys[i]);
        if (v) fresh[keys[i]] = v;
      }
    }
    var stored = {};
    try { stored = JSON.parse(safeLS('get', ATTR_KEY) || '{}'); } catch (_) {}
    if (!Array.isArray(stored.touches)) stored.touches = [];
    var TOUCHES_CAP = 20;
    var hasFresh = Object.keys(fresh).length > 0;
    var nowIso = new Date().toISOString();
    // T2.12 — multi-touch attribution. Keep first_touch + last_touch (Meta/
    // Google read them directly) AND append every observed touch to a
    // bounded touches array. Cap at 20 entries; older drops first.
    if (hasFresh) {
      var entry = Object.assign(
        { captured_at: nowIso, landing_path: location.pathname, referrer: document.referrer || null },
        fresh,
      );
      if (!stored.first_touch) stored.first_touch = entry;
      stored.last_touch = entry;
      stored.touches.push(entry);
      if (stored.touches.length > TOUCHES_CAP) {
        stored.touches = stored.touches.slice(-TOUCHES_CAP);
      }
      safeLS('set', ATTR_KEY, JSON.stringify(stored));
    } else if (!stored.first_touch && document.referrer) {
      var referrerEntry = { captured_at: nowIso, landing_path: location.pathname, referrer: document.referrer };
      stored.first_touch = referrerEntry;
      stored.last_touch = referrerEntry;
      stored.touches.push(referrerEntry);
      safeLS('set', ATTR_KEY, JSON.stringify(stored));
    }
    return stored;
  }

  var anonymousId = getOrCreateAnonymousId();
  var sessionInfo = getOrRefreshSession();
  var attribution = captureAttribution();
  var fbc = getOrSetFbc();
  var fbp = getOrSetFbp();

  var CONSENT_KEY = '_etus_consent';
  var CONSENT_TTL = 60 * 60 * 24 * 365;

  function defaultConsent() {
    var strict = false;
    try {
      var tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      strict = /^(Europe\/|Atlantic\/(Reykjavik|Madeira|Canary|Azores|Faroe)|Africa\/Ceuta|Africa\/Johannesburg|Africa\/Cairo|Asia\/(Seoul|Pyongyang|Kolkata|Calcutta|Bangkok|Jakarta|Ho_Chi_Minh|Saigon|Dubai|Riyadh|Istanbul)|America\/(Sao_Paulo|Recife|Bahia|Belem|Fortaleza|Maceio|Manaus|Cuiaba|Porto_Velho|Rio_Branco|Boa_Vista|Campo_Grande|Eirunepe|Noronha|Santarem|Araguaina)|Brazil\/)/.test(tz);
    } catch (_) {}
    return strict
      ? { analytics: false, marketing: false, personalization: false, source: 'default-strict', ts: Date.now() }
      : { analytics: true, marketing: true, personalization: true, source: 'default-permissive', ts: Date.now() };
  }

  function readConsent() {
    var raw = readCookie(CONSENT_KEY);
    if (raw) {
      try { return JSON.parse(raw); } catch (_) {}
    }
    var ls = safeLS('get', CONSENT_KEY);
    if (ls) {
      try { return JSON.parse(ls); } catch (_) {}
    }
    return null;
  }

  var consentState = readConsent() || defaultConsent();

  // T1.5.B13 — events emitted before the user clicks the banner are held in a
  // client-side buffer when the jurisdiction default is strict (EEA/UK/BR etc).
  // The buffer is drained to the server queue only after explicit consent;
  // a reject drops it. consent_updated events bypass the buffer (audit trail).
  var preConsentBuffer = [];
  function isPreConsent() {
    return consentState && typeof consentState.source === 'string' &&
      consentState.source.indexOf('default-strict') === 0;
  }

  function setConsent(next) {
    var prev = consentState;
    consentState = Object.assign({}, next, {
      ts: Date.now(),
      source: next.source || 'banner',
    });
    var serialized = JSON.stringify(consentState);
    safeLS('set', CONSENT_KEY, serialized);
    writeCookie(CONSENT_KEY, serialized, CONSENT_TTL);
    window.dispatchEvent(new CustomEvent('etus:consent', { detail: consentState }));
    // T1.5.B13 — emit a server-side audit event on every transition. GDPR
    // Art. 7(1) requires demonstrating that consent was freely given; the
    // server log of {old,new,source} satisfies that.
    try {
      track('consent_updated', {
        previous: prev || null,
        next: consentState,
        source: consentState.source,
      });
    } catch (_) {}
    // Drain or drop the pre-consent buffer based on the new analytics flag.
    if (consentState && consentState.analytics) {
      while (preConsentBuffer.length) {
        var ev = preConsentBuffer.shift();
        serverQueue.push(ev);
      }
    } else {
      preConsentBuffer.length = 0;
    }
    try { flushNow(); } catch (_) {}
  }

  function getConsent() { return consentState; }

  // T2.14 — cache the never-changing parts of context across calls. Per-call
  // hot path is page + campaign + consent + viewport + network. The rest
  // (tenant_id, locale, device, screen) is fixed for the page lifetime.
  var _staticCtx = null;
  function buildStaticCtx() {
    var nav = navigator || {};
    var tz = null;
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (_) {}
    return {
      tenant_id: cfg.tenant_id,
      locale: cfg.locale,
      theme: cfg.theme || null,
      device: {
        user_agent: nav.userAgent || null,
        language: nav.language || null,
        languages: nav.languages || null,
        timezone: tz,
        hardware_concurrency: nav.hardwareConcurrency || null,
        device_memory_gb: nav.deviceMemory || null,
        touch_points: nav.maxTouchPoints || 0,
      },
      screen: {
        width: screen.width,
        height: screen.height,
        density: window.devicePixelRatio || 1,
        orientation: screen.orientation ? screen.orientation.type : null,
      },
    };
  }
  // GA4 server-side (Measurement Protocol) needs the SAME client_id + session_id the
  // gtag tag uses, or MP events orphan (phantom users / no session stitch). Read them
  // from the GA4 cookies: _ga = GA1.n.<clientId 2 parts>; _ga_<id> = GS1.n.<sessionId>...
  function readGaClientId() {
    var ga = readCookie('_ga');
    if (!ga) return null;
    var p = ga.split('.');
    return p.length >= 4 ? p[2] + '.' + p[3] : null;
  }
  function readGaSessionId() {
    var t = cfg.tracking && cfg.tracking.ga4;
    var mid = t && t[0] && t[0].measurementId;
    if (!mid) return null;
    var gs = readCookie('_ga_' + String(mid).replace(/^G-/, ''));
    if (!gs) return null;
    var p = gs.split('.');
    return p.length >= 3 ? p[2] : null;
  }
  function getContext() {
    if (!_staticCtx) _staticCtx = buildStaticCtx();
    var nav = navigator || {};
    var conn = nav.connection || nav.mozConnection || nav.webkitConnection || {};
    return {
      tenant_id: _staticCtx.tenant_id,
      locale: _staticCtx.locale,
      theme: _staticCtx.theme || null,
      vertical: cfg.vertical || null,
      identity: {
        fbp: fbp || null,
        fbc: fbc || null,
        ga_client_id: readGaClientId(),
        ga_session_id: readGaSessionId(),
      },
      consent: consentState,
      page: {
        path: location.pathname,
        url: location.href,
        title: document.title || null,
        referrer: document.referrer || null,
        search: location.search || null,
        hash: location.hash || null,
      },
      campaign: {
        first_touch: attribution.first_touch || null,
        last_touch: attribution.last_touch || null,
        touches: attribution.touches || [],
      },
      // T2 — resolved pixel matrix snapshot. Consumers read this to know
      // which pixels to fan out to (multi-pixel/multi-account support).
      tracking: cfg.tracking || null,
      device: _staticCtx.device,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      screen: _staticCtx.screen,
      network: {
        effective_type: conn.effectiveType || null,
        save_data: !!conn.saveData,
        downlink_mbps: conn.downlink || null,
        rtt_ms: conn.rtt || null,
      },
    };
  }

  var serverQueue = [];
  var flushTimer = null;
  var FLUSH_DEBOUNCE_MS = 250;
  var FLUSH_MAX_BATCH = 10;

  function enqueueServer(serverEvent) {
    if (!cfg.writeKey || !serverEvent) return;
    // T1.5.B13 — divert to the pre-consent buffer in strict regions until
    // the user clicks the banner. consent_updated ALWAYS reaches the wire
    // (audit trail), even pre-decision.
    var isConsentUpdate = serverEvent.event === 'consent_updated';
    if (isPreConsent() && !isConsentUpdate) {
      preConsentBuffer.push(serverEvent);
      return;
    }
    serverQueue.push(serverEvent);
    if (serverQueue.length >= FLUSH_MAX_BATCH) {
      flushNow();
    } else {
      scheduleFlush();
    }
  }

  function scheduleFlush() {
    if (flushTimer) return;
    var schedule = window.requestIdleCallback ||
      function (cb) { return setTimeout(cb, FLUSH_DEBOUNCE_MS); };
    flushTimer = schedule(function () {
      flushTimer = null;
      flushNow();
    }, { timeout: FLUSH_DEBOUNCE_MS });
  }

  function flushNow() {
    if (flushTimer) {
      var cancel = window.cancelIdleCallback || window.clearTimeout;
      try { cancel(flushTimer); } catch (_) {}
      flushTimer = null;
    }
    if (!serverQueue.length || !cfg.writeKey) return;
    var batch = serverQueue.splice(0, serverQueue.length);
    sendBatchInternal(batch, false);
  }

  function flushBeacon() {
    if (!serverQueue.length || !cfg.writeKey) return;
    var batch = serverQueue.splice(0, serverQueue.length);
    sendBatchInternal(batch, true);
  }

  // T1.5.B3 — sendBeacon bypasses Service Worker (Chromium/WebKit spec), so
  // offline pagehide events get lost. We use fetch keepalive instead — same
  // semantics, but SW intercepts and queues in IDB.
  // T1.5.B4 — keepalive fetch has a 64KB body cap on iOS Safari (less on some
  // versions); split batches recursively at 60KB to stay safely under.
  // T1.5.B2 — write_key NEVER in query string (would leak via Referer on
  // external redirects from /processing); always Authorization header.
  var KEEPALIVE_MAX_BYTES = 60000;
  function sendBatchInternal(events, _viaBeacon) {
    if (!events || !events.length) return;
    var baseUrl = (cfg.eventsApiUrl || '') + '/v1/e';
    var body = JSON.stringify(events.length === 1 ? events[0] : { batch: events });
    if (body.length > KEEPALIVE_MAX_BYTES && events.length > 1) {
      var mid = Math.ceil(events.length / 2);
      sendBatchInternal(events.slice(0, mid), _viaBeacon);
      sendBatchInternal(events.slice(mid), _viaBeacon);
      return;
    }
    try {
      fetch(baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + cfg.writeKey,
          // T1.5.H18 — explicit pending-aid header so identity survives across
          // offline drain. The body also carries anonymousId, but a queued
          // request replayed by the SW gets re-cookied by the browser; the
          // header is the only field guaranteed to match the original visit.
          'x-etus-aid-pending': anonymousId,
        },
        body: body,
        keepalive: true,
      }).then(function (res) {
        // T1.5.B6 — SW responds 503 when it failed to enqueue (Safari private
        // mode, QuotaExceeded). Put the events back at the head of the queue
        // so they get another shot on the next flush instead of vanishing.
        if (res && res.status === 503) {
          for (var i = events.length - 1; i >= 0; i--) {
            serverQueue.unshift(events[i]);
          }
          scheduleFlush();
        }
      }).catch(function () {});
    } catch (_) {}
  }

  function track(eventName, properties) {
    var now = Date.now();
    sessionInfo.sess.last_activity_at = now;
    safeLS('set', SESSION_KEY, JSON.stringify(sessionInfo.sess));
    var eventId = uuid();
    var payload = {
      event: eventName,
      event_id: eventId,
      ts: new Date(now).toISOString(),
      anonymous_id: anonymousId,
      session_id: sessionInfo.sess.id,
      session_index: sessionInfo.sess.index,
      properties: properties || {},
      context: getContext(),
    };
    window.dataLayer.push(payload);
    window.dispatchEvent(new CustomEvent('etus:track', { detail: payload }));
    enqueueServer(buildServerEvent('track', {
      messageId: eventId,
      event: eventName,
      properties: properties || {},
    }));
    return payload;
  }

  function buildServerEvent(type, extra) {
    return Object.assign({
      type: type,
      messageId: uuid(),
      timestamp: new Date().toISOString(),
      sentAt: new Date().toISOString(),
      anonymousId: anonymousId,
      context: getContext(),
      channel: 'web',
    }, extra || {});
  }

  function sendBatch(events) {
    if (!cfg.writeKey) return Promise.resolve(null);
    if (!events || !events.length) return Promise.resolve(null);
    var url = (cfg.eventsApiUrl || '') + '/v1/e';
    try {
      return fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + cfg.writeKey,
          'x-etus-aid-pending': anonymousId,
        },
        body: JSON.stringify(events.length === 1 ? events[0] : { batch: events }),
        keepalive: true,
      }).catch(function () { return null; });
    } catch (_) {
      return Promise.resolve(null);
    }
  }

  function identify(traits) {
    var now = Date.now();
    sessionInfo.sess.last_activity_at = now;
    safeLS('set', SESSION_KEY, JSON.stringify(sessionInfo.sess));
    var eventId = uuid();
    var payload = {
      event: 'identify',
      event_id: eventId,
      ts: new Date(now).toISOString(),
      anonymous_id: anonymousId,
      session_id: sessionInfo.sess.id,
      session_index: sessionInfo.sess.index,
      traits: traits || {},
      context: getContext(),
    };
    window.dataLayer.push(payload);
    window.dispatchEvent(new CustomEvent('etus:identify', { detail: payload }));
    enqueueServer(buildServerEvent('identify', {
      messageId: eventId,
      traits: traits || {},
    }));
    return payload;
  }

  window.etus = {
    __booted: true,
    track: track,
    identify: identify,
    sendBatch: sendBatch,
    buildServerEvent: buildServerEvent,
    flush: flushNow,
    flushBeacon: flushBeacon,
    consent: { get: getConsent, set: setConsent },
    anonymousId: function () { return anonymousId; },
    sessionId: function () { return sessionInfo.sess.id; },
    attribution: function () { return attribution; },
    context: getContext,
    eventsApiUrl: function () { return cfg.eventsApiUrl; },
    setQuizLifecycle: function (state, extra) {
      try {
        var payload = Object.assign({}, extra || {}, { state: state, updated_at: Date.now() });
        sessionStorage.setItem(QUIZ_LIFECYCLE_KEY, JSON.stringify(payload));
      } catch (_) {}
    },
    getQuizLifecycle: function () {
      try { return JSON.parse(sessionStorage.getItem(QUIZ_LIFECYCLE_KEY) || 'null'); } catch (_) { return null; }
    },
  };

  // T1.5.B5 — drain the stub queue now that the real API is in place.
  var __pending = window.__etusQueue || [];
  window.__etusQueue = null;
  for (var __i = 0; __i < __pending.length; __i++) {
    var __op = __pending[__i][0];
    var __args = __pending[__i][1];
    try {
      if (__op === 'track') window.etus.track.apply(null, __args);
      else if (__op === 'identify') window.etus.identify.apply(null, __args);
      else if (__op === 'flush') window.etus.flush.apply(null, __args);
      else if (__op === 'flushBeacon') window.etus.flushBeacon.apply(null, __args);
      else if (__op === 'consent.set') window.etus.consent.set.apply(null, __args);
      else if (__op === 'setQuizLifecycle') window.etus.setQuizLifecycle.apply(null, __args);
    } catch (_) {}
  }
  try { window.dispatchEvent(new CustomEvent('etus:ready')); } catch (_) {}

  // T2.4 — error_occurred. Catches uncaught JS errors and unhandled promise
  // rejections. We cap message + stack to bound payload size; full repro
  // lives in CF Browser Insights / Sentry once those land.
  var _errLastSig = '';
  var _errLastAt = 0;
  function emitError(kind, message, source, lineno, colno, stack) {
    var sig = kind + '|' + message + '|' + (source || '');
    var now = Date.now();
    // Dedup bursts: drop the same error if it fires again within 1s
    // (browsers re-fire onerror under some conditions during page tear-down).
    if (sig === _errLastSig && now - _errLastAt < 1000) return;
    _errLastSig = sig; _errLastAt = now;
    try {
      track('error_occurred', {
        kind: kind,
        message: typeof message === 'string' ? message.slice(0, 512) : String(message).slice(0, 512),
        source: source ? String(source).slice(0, 256) : null,
        lineno: typeof lineno === 'number' ? lineno : null,
        colno: typeof colno === 'number' ? colno : null,
        stack: stack ? String(stack).slice(0, 1024) : null,
      });
    } catch (_) {}
  }
  window.addEventListener('error', function (ev) {
    var err = ev && ev.error;
    emitError(
      'error',
      ev && ev.message ? ev.message : (err && err.message) || 'unknown',
      ev && ev.filename,
      ev && ev.lineno,
      ev && ev.colno,
      err && err.stack,
    );
  });
  window.addEventListener('unhandledrejection', function (ev) {
    var reason = ev && ev.reason;
    emitError(
      'unhandledrejection',
      reason && reason.message ? reason.message : String(reason),
      null,
      null,
      null,
      reason && reason.stack,
    );
  });

  var lastPvHref = null;
  function firePageView(trigger) {
    if (trigger !== 'bfcache' && location.href === lastPvHref) return;
    var prev = lastPvHref;
    lastPvHref = location.href;
    var refreshed = getOrRefreshSession();
    sessionInfo = refreshed;
    if (refreshed.isNew) track('session_started', { trigger: trigger });
    track('page_view', {
      trigger: trigger,
      previous_url: prev || document.referrer || null,
    });
  }

  firePageView('initial');

  document.addEventListener('astro:page-load', function () {
    firePageView('client_router');
  });

  window.addEventListener('pageshow', function (e) {
    if (e && e.persisted) firePageView('bfcache');
  });

  var abandonmentSent = false;
  function maybeFireAbandoned(reason) {
    if (abandonmentSent) return;
    var lc = window.etus.getQuizLifecycle();
    if (!lc || lc.state !== 'in_progress') return;
    abandonmentSent = true;
    var startedAt = lc.started_at || null;
    track('quiz_abandoned', {
      quiz_slug: lc.quiz_slug || null,
      vertical: lc.vertical || null,
      mode: lc.mode || null,
      last_step_id: lc.last_step_id || null,
      last_step_index: typeof lc.last_step_index === 'number' ? lc.last_step_index : null,
      time_on_quiz_ms: startedAt ? Date.now() - startedAt : null,
      reason: reason,
    });
    window.etus.setQuizLifecycle('abandoned', Object.assign({}, lc, {
      abandoned_at: Date.now(),
      reason: reason,
    }));
  }

  // T1.5.H7 — abandonment fires only on pagehide. visibilitychange triggers
  // every app-switch (iOS lockscreen, tab change, share sheet, picture-in-
  // picture), inflating abandonment ~2-3x on mobile when the user just looked
  // at another tab for 2s. pagehide is the only signal that semantically
  // means "this page is going away". visibilitychange still flushes the
  // queue (cheap, beneficial — events get delivered if the tab is killed).
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      flushBeacon();
    }
  }, { capture: true });
  window.addEventListener('pagehide', function (e) {
    if (e && e.persisted) { flushBeacon(); return; }
    maybeFireAbandoned('pagehide');
    flushBeacon();
  }, { capture: true });
})();
