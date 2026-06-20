# @etus/ads

Production-grade Google Ad Manager / GPT integration for Astro, encoding
**every practitioner-verified finding** from the gotallcards.com revenue audit
(3 adversarial deep-research passes, ~70 confirmed claims, primary-sourced).

## Why this exists

Most blog/ad implementations copy a "GPT snippet" from 2018 docs. This
package is built from the **live GPT reference + release notes (verified June
2026)** — not memory. The verification caught real bugs (see "Verification
log" below); this table reflects the corrected design.

| Practice | What this package does | Why |
|---|---|---|
| **Typed inline bootstrap** | Typed emitters (`src/emit.ts`) render the GPT bootstrap + slot definitions as `<script is:inline>` in the `<head>`, queued on `googletag.cmd` **during HTML parse** so the queue is populated before async `gpt.js` lands and drains it. Only `gpt.js` is external. Interpolated values are escaped for the script context. | An external bundled module adds a fetch round-trip on the critical path and can RACE `gpt.js` (library lands, finds an empty queue, does nothing). Inline = fastest time-to-first-ad, no race. Under a strict CSP the inline scripts carry the per-request nonce. |
| **Modern setConfig API** | `googletag.setConfig({ singleRequest, lazyLoad, collapseDiv?, pps? })` | `enableSingleRequest` / `enableLazyLoad` / `disableInitialLoad` / `collapseEmptyDivs` were all **deprecated the week of 2025-07-28** in favor of `setConfig`. |
| **Observability** | Re-broadcasts GPT slot events as one `etus:ad` CustomEvent (`render`/`empty`/`viewable`/`load`). | The audit found a vendor silently 503-ing. Host apps can now monitor fill/empty/viewability without patching the package. |
| **Ad labeling + unit tests** | `<AdSlot/>` renders an "Advertisement" disclosure; pure logic (config, serialization, refresh-clamp) covered by Vitest. | Better Ads Standards compliance; the parts that can be unit-tested are. |
| **Coherent load orchestration** | `singleRequest: true` + `lazyLoad` + per-slot `display()`. **No** `disableInitialLoad`, **no** global `refresh()`. | SRA batches all slots defined before the first `display()` into ONE request; `lazyLoad` defers below-fold. A no-arg `refresh()` would force-fetch **all** slots and silently defeat lazy-load (control-ad-loading guide). `disableInitialLoad` is the *header-bidding* defer pattern — pointless without HB. |
| **mobileScaling lazy-load** | Default `mobileScaling: 2.0` for fast-scroll mobile users. | Captures impressions visitors will actually see. Reduces **ad-JS blocking time** — Google's #1 named cause of main-thread blocking (Pass-2). |
| **Zero CLS** | Every `<AdSlot/>` requires a `reserve={…}` map per breakpoint → inline `min-height`. `collapseDiv` is **UNSET by default**. | CLS is a Core Web Vital → INP/ranking signal. Collapsing on no-fill *causes* a shift; reserving + not collapsing = zero CLS. |
| **Declared viewable refresh** | Viewable-gated (≥50%), 60s recommended, **hard 30s floor** (GAM policy), capped per session, tagged `refresh=1`. | Pass-3: undeclared refresh is an EXPLICIT Google policy violation Google actively detects. **You MUST declare refresh inventory in GAM.** |
| **Web interstitial** | All triggers (unhideWindow, navBar, inactivity, backward, endOfArticle) configurable. Defaults safe. | Direct SEO exposure (Google Search intrusive-interstitial rules). Freq-cap in GAM (default 1/10min). |
| **Anchor — adaptive sizes** | OOP `TOP_ANCHOR`/`BOTTOM_ANCHOR`. Encourages 320×100/320×50/Fluid in the GAM unit. | Audit data: fixed 320×100 had ~0 demand; Fluid adaptive ~96px served at $82–91 eCPM vs $57 for fixed 320×50. |
| **Side rails** | `<AdSideRail side="left\|right"/>` → `LEFT_SIDE_RAIL`/`RIGHT_SIDE_RAIL` (added 2023-12-11). | High-value, low-intrusion desktop gutter inventory. GAM-managed. |
| **PPID** | Stable hashed-UUID per browser in `localStorage`, injected via `setPublisherProvidedId()` **before** the first display (NOT deprecated). | Topics/Protected Audience retired in 2026 → PPID is the durable cookieless lever. Google self-reports 15%+ uplift **on the cookieless slice only.** Validate with Prebid ELM. |
| **Secure Signals (ESP)** | Provider list, registered on `googletag.secureSignalProviders` before `enableServices()`. | Encrypted first-party signals to authorized buyers. |
| **Publisher Provided Signals (PPS)** | `setConfig({ pps: { taxonomies: {...} }})` — **typed pass-through** (you supply IAB taxonomy keys + IDs verbatim). DISTINCT from Secure Signals. | First-party IAB Audience 1.1 / Content 2.2 signals. Added to GPT 2024-02. We don't hardcode taxonomy keys we can't test. |
| **Privacy** | `setPrivacySettings({ nonPersonalizedAds?, tagForAgeTreatment? })` (NOT deprecated). `tagForAgeTreatment` added 2026-04-20. | Consent / child-teen treatment, opt-in. |
| **Consent gating** | TCF v2.3 + GPP helper; never blocks ad requests where US opt-out applies (Pass-1). | Don't add a CMP round-trip to first-ad-request latency on US traffic. |
| **Preconnect** | `<link rel="preconnect">` for all 5 ad origins. | Shaves DNS/TLS off the first ad request (Pass-2 F1). |
| **Full-page nav (no ClientRouter)** | Deliberately no Astro View Transitions. | Each pageview gets a clean GPT lifecycle — no slot re-init dance, no refresh/double-count hazard. If you add `<ClientRouter/>` you must `destroySlots()` + redefine on `astro:page-load`. |
| **INP-aware** | Minimal main-thread budget; no client JS beyond gpt.js. | INP replaced FID on 2024-03-12 — measures every interaction, so heavy ad/pixel JS that hid under FID now compresses INP → CWV → rankings. |

## Quick start

```astro
---
// src/layouts/BaseLayout.astro
import AdScripts from '@etus/ads/components/AdScripts.astro'
const adsConfig = {
  networkCode: '21842055933',
  mcmManagerDomain: 'brius.com.br',
  lazyLoad: { fetchMarginPercent: 100, renderMarginPercent: 50, mobileScaling: 2.0 },
  secureSignalProviders: [
    { id: 'id5-sync.com', networkCode: '1' },
  ],
}
---
<html>
<head><AdScripts config={adsConfig} /></head>
<body><slot/></body>
</html>
```

```astro
---
import AdSlot from '@etus/ads/components/AdSlot.astro'
import AdAnchor from '@etus/ads/components/AdAnchor.astro'
import AdInterstitial from '@etus/ads/components/AdInterstitial.astro'
const adsConfig = { networkCode: '21842055933' }
---
<article>
  <AdSlot config={adsConfig} adUnit="post/top" abovefold
          sizes={{ 0: [[336,280],[300,250]], 768: [[728,90],[300,250]] }}
          reserve={{ 0: 280, 768: 250 }} />
  <p>…</p>
  <AdSlot config={adsConfig} adUnit="post/in-content"
          sizes={{ 0: [[336,280],[300,250],'fluid'] }}
          reserve={{ 0: 280 }} refresh />
</article>
<AdAnchor      config={adsConfig} adUnit="anchor" position="bottom" />
<AdInterstitial config={adsConfig} adUnit="interstitial" />
```

## Required GAM-side setup

This is the *client side*. You MUST also:

1. **Declare refresh inventory** in GAM: Inventory rules → Declare refresh. Trigger=Event/Time, interval=60s. Undeclared refresh = policy violation Google actively detects (Pass-3, GAM Help 6286179).
2. **Enable Fluid + adaptive sizes** on anchor / in-content units. Audit data: fixed 320×100 had ~0 demand vs adaptive at $82–91 eCPM.
3. **Set web-interstitial frequency cap** in GAM (default 1/10min, configurable to 1/min).
4. **MANAGERDOMAIN in `ads.txt`** if you're MCM-managed (Brius etc.). DV360 defaults to bidding ONLY on Authorized sellers — ads.txt errors actively suppress demand (Pass-3).
5. **Diagnose with the Publisher Ads Lighthouse Plugin** (Google's own — covers tag-load-time, first-ad-render, total-ad-blocking-time). Vanilla Lighthouse can't attribute main-thread cost to the ad stack.

## What this package does NOT do

- **Header bidding (Prebid).** Add it on top. When you do, measure incrementality with the **Prebid ELM (Enrichment Lift Measurement)** module — randomized holdouts on request-level eCPM + total revenue. **Vendor-blog uplift % numbers (10–50%) did not survive any of 3 adversarial verification passes.**
- **CMP (consent manager).** Bring your own (Funding Choices, Sourcepoint…). `purpose1Permitted()` just reads `__tcfapi` / `__gpp`.
- **Server-side ad rendering.** GPT is client-side by design.

## Verification log (June 2026 — live GPT reference + release notes)

The first cut of this package was built from cached research. A fresh pass
against the **live** `developers.google.com/publisher-tag/reference`,
`/release-notes`, and `/guides/control-ad-loading` caught real issues — kept
here for honesty and so the next maintainer doesn't reintroduce them:

| Found | Status | Fix |
|---|---|---|
| `disableInitialLoad()` + a no-arg `pubads().refresh()` on load | **Bug** — the no-arg refresh force-fetches every slot, silently defeating `lazyLoad`; `disableInitialLoad` is the header-bidding defer pattern, pointless here | Removed both. Now `singleRequest` + `lazyLoad` + per-slot `display()`. |
| `googletag.pubads().enableAsyncRendering()` | **Bug** — not in the 2026 reference (async is the only mode) | Removed. |
| `collapseEmptyDivs()` method | Deprecated 2025-07-28 | → `setConfig({ collapseDiv })`, and **unset by default** for zero CLS. |
| `enableSingleRequest()` / `enableLazyLoad()` | Deprecated 2025-07-28 | Already on `setConfig` — confirmed correct. |
| `setPublisherProvidedId()` / `setPrivacySettings()` | **Not** deprecated | Kept as-is. |
| PPS (`setConfig({ pps })`) | Missing capability (added GPT 2024-02) | Added as a typed pass-through. |
| `LEFT/RIGHT_SIDE_RAIL` (added 2023-12-11) | Missing format | Added `<AdSideRail/>`. |
| `tagForAgeTreatment` (added 2026-04-20) | Missing privacy field | Added optional pass-through. |
| View Transitions + gpt.js re-init hazard | Decision | Stay on full-page nav; documented. |

### v0.2 golden rewrite (adopting `@types/google-publisher-tag@1.20260525.0`)

Typing the package against the official GPT types caught more — the value of
using real types over memory:

| Found | Fix |
|---|---|
| Untyped inline `set:html` strings (no types, unescaped) | Kept the inline bootstrap — it's the fastest, race-free design (see `emit.ts`) — but made the emitters **typed** and **escaped for the script context**. (An earlier v0.2 detour to a bundled `data-*` client was reverted: it added a round-trip and raced `gpt.js`.) |
| `tagForChildDirectedTreatment` (guessed field name) | Real API is `PrivacySettingsConfig.tagForAgeTreatment` (enum `UNSPECIFIED`/`CHILD`/`TEEN`) **plus** `childDirectedTreatment`/`underAgeOfConsent`. Used the real `tagForAgeTreatment`. |
| `collapseDiv` assumed 2 values | Real `CollapseDivBehavior` is `"DISABLED" \| "BEFORE_FETCH" \| "ON_NO_FILL"` — added `DISABLED`. |
| `abovefold` prop was inert | Still informational/reserved: with `singleRequest` + `lazyLoad` the SRA already batches above-fold slots and defers below-fold, so no explicit ordering is applied. |
| Dead `purpose1Permitted()` consent helper | Removed — GPT forwards TCF + enters Limited Ads natively with a certified CMP. |
| No ad label, no observability, no tests | Added "Advertisement" label, `etus:ad` events, 21 Vitest cases. |

Honesty note: where my earlier release-note reading and the official `@types`
disagreed, I deferred to the **types** (authoritative, dated 2026-05-25) and
verified each field exists before shipping it.

Post-build verification (runtime SSR HTML): modern `setConfig`/`singleRequest`/
`lazyLoad`/`setPublisherProvidedId`/`defineSlot`/`defineOutOfPageSlot`/
`impressionViewable`/`etus:ad` PRESENT **inline** in the `<head>`, queued on
`googletag.cmd` before async `gpt.js`; the deprecated `enableSingleRequest`/
`enableLazyLoad`/`enableAsyncRendering`/`disableInitialLoad`/`collapseEmptyDivs`
ABSENT everywhere (regression-guarded by `emit.test.ts`).

## Pass-3 honesty caveat

Three adversarial deep-research passes (~70 confirmed claims, primary-sourced)
failed to triangulate any defensible quantitative uplift figure for header
bidding, refresh, or PPID. Every "X% revenue lift" claim was either a 2016
anecdote or unverifiable vendor marketing. Treat any uplift number you see
online as folklore. Measure with randomized holdouts on your own data.
