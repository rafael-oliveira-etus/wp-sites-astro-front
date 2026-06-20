// The analytics boot is split in two:
//
//   1. BOOT_STUB (here) — a tiny SYNCHRONOUS IIFE injected inline in <head> by
//      AnalyticsBoot.astro. It installs `window.dataLayer` and the queuing
//      `window.etus` STUB the instant the document parses, so every downstream
//      guard (`if (window.etus && window.etus.track)`, `window.etus?.track`)
//      sees the same early presence it always has. This presence is
//      load-bearing: PageViewTracker's `__etusInitialPageViewSkipped` no-op on
//      the initial paint, plus the WebVitals/Quiz/PostView call-queueing, all
//      key off `window.etus` existing during initial parse. Keeping the stub
//      synchronous preserves that EXACT ordering now that the engine itself
//      moved out to a deferred, hashed/cached module.
//
//   2. The real engine — `src/lib/analytics-boot-engine.ts` — shipped as an
//      Astro-bundled (`<script>import …`) module: hashed, immutable, cached
//      across pages/navigations instead of re-sent inline on every request.
//      It reads its config from `window.__etusCfg` (set inline next to the
//      stub), guards on `__booted`, runs the engine, installs the real
//      `window.etus`, and drains `window.__etusQueue`.
//
// BOOT_STUB must NOT reference `cfg` — it runs before the engine consumes cfg.
// It only sets up the queue.

export const BOOT_STUB = String.raw`(function () {
  window.dataLayer = window.dataLayer || [];
  // T1.5.B5 — drain pattern. Any code that runs before the engine module
  // finishes (other inline scripts, deferred modules, third-party bundles)
  // gets a stub that queues the call into window.__etusQueue. The engine
  // drains and dispatches the queue once it boots.
  if (!window.etus) {
    var __q = (window.__etusQueue = window.__etusQueue || []);
    var __stub = function (op) {
      return function () {
        __q.push([op, Array.prototype.slice.call(arguments)]);
      };
    };
    window.etus = {
      __booted: false,
      track: __stub('track'),
      identify: __stub('identify'),
      flush: __stub('flush'),
      flushBeacon: __stub('flushBeacon'),
      sendBatch: function () { return Promise.resolve(null); },
      consent: { set: __stub('consent.set'), get: function () { return null; } },
      anonymousId: function () { return null; },
      sessionId: function () { return null; },
      attribution: function () { return {}; },
      context: function () { return {}; },
      eventsApiUrl: function () { return ''; },
      setQuizLifecycle: __stub('setQuizLifecycle'),
      getQuizLifecycle: function () { return null; },
    };
  }
})();`;
