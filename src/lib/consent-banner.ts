// Consent-banner wiring, externalized from ConsentBanner.astro (Task 11).
//
// The former inline <script data-astro-rerun> body lives here, exposed as
// window.__etusConsentInit so a minimal inline data-astro-rerun shim can
// re-invoke it after every View-Transition navigation (ClientRouter re-runs
// inline data-astro-rerun scripts but NOT bundled module scripts). The bundled
// module is hashed/cached by Astro, so the ~1.7 KB body ships once instead of
// per-page.
//
// init() is idempotent: it short-circuits if the banner is missing or already
// bound (dataset.bound === '1'), exactly like the original IIFE. We assign the
// global first, then call it once on import to cover the initial (non-VT) load.

function init(): void {
  var banner = document.querySelector('[data-consent-banner]') as
    | HTMLElement
    | null;
  if (!banner) return;
  if (banner.dataset.bound === '1') return;
  banner.dataset.bound = '1';

  function show() {
    banner!.hidden = false;
    window.requestAnimationFrame(function () {
      banner!.classList.add('is-visible');
    });
  }
  function hide() {
    banner!.classList.remove('is-visible');
    window.setTimeout(function () {
      banner!.hidden = true;
    }, 240);
  }

  function decide(accept: boolean) {
    if (!window.etus || !window.etus.consent) {
      // boot not ready — short retry
      setTimeout(function () {
        decide(accept);
      }, 100);
      return;
    }
    window.etus.consent.set({
      analytics: accept,
      marketing: accept,
      personalization: accept,
      source: 'banner',
    });
    hide();
  }

  function maybeShow() {
    if (!window.etus || !window.etus.consent) {
      setTimeout(maybeShow, 100);
      return;
    }
    var s = window.etus.consent.get();
    // Only show if user hasn't decided yet (source !== 'banner').
    // GPC (`Sec-GPC: 1`) is also a deliberate choice — respect it without banner.
    if (s && (s.source === 'banner' || s.source === 'gpc')) return;
    show();
  }

  banner
    .querySelector('[data-consent-accept]')!
    .addEventListener('click', function () {
      decide(true);
    });
  banner
    .querySelector('[data-consent-reject]')!
    .addEventListener('click', function () {
      decide(false);
    });

  // Defer initial check until idle so it doesn't block LCP.
  var defer =
    window.requestIdleCallback ||
    function (cb: () => void) {
      return setTimeout(cb, 400);
    };
  defer(maybeShow, { timeout: 1500 });
}

window.__etusConsentInit = init;
init();
