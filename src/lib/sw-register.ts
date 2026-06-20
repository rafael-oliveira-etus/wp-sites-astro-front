// Service-worker register/unregister logic, externalized from
// ServiceWorkerRegister.astro (Task 11). Astro bundles this as a hashed,
// immutable /_astro/*.js module <script> — cached across pages & navigations —
// instead of re-emitting ~1.3 KB of inline JS on every HTML response.
//
// Behavior is byte-for-byte the former inline IIFE bodies, just relocated.
// The dev/prod split is preserved via import.meta.env.DEV (statically replaced
// at build, so only the relevant branch ships in each build).
//
// PRODUCTION: register /sw.js and nudge the event queue to flush on register,
// `online`, and `controllerchange`.
// DEV: the SW is a footgun locally (network-first HTML w/ 2s timeout serves
// stale cached pages during slow Vite recompiles), so we UNREGISTER any
// existing SW and nuke its caches instead.

if (import.meta.env.DEV) {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .getRegistrations()
      .then(function (regs) {
        regs.forEach(function (r) {
          r.unregister();
        });
      })
      .catch(function () {});
  }
  if (self.caches && caches.keys) {
    caches
      .keys()
      .then(function (keys) {
        keys.forEach(function (k) {
          caches.delete(k);
        });
      })
      .catch(function () {});
  }
} else {
  (function () {
    if (!('serviceWorker' in navigator)) return;
    if (
      location.protocol !== 'https:' &&
      location.hostname !== 'localhost' &&
      location.hostname !== '127.0.0.1'
    )
      return;

    function nudgeFlush() {
      try {
        navigator.serviceWorker.ready.then(function (reg) {
          if (reg.active) {
            try {
              reg.active.postMessage({ type: 'flush-events' });
            } catch (_) {}
          }
        });
      } catch (_) {}
    }

    var register = function () {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then(function () {
          // Initial drain after register.
          if (navigator.onLine) nudgeFlush();
        })
        .catch(function () {});
    };

    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });

    // Drain whenever we transition back online.
    window.addEventListener('online', nudgeFlush);

    // Drain when a new SW takes over (post-deploy activation).
    if (navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener('controllerchange', nudgeFlush);
    }
  })();
}
