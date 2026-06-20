/**
 * INLINE script emitters — the Phase-3 centerpiece.
 *
 * WHY INLINE (verified by research): the GPT bootstrap (your googletag.cmd.push
 * config + slot definitions) must run during initial HTML parse so the cmd
 * queue is POPULATED before async gpt.js lands and drains it. An external
 * bundled module adds a fetch round-trip on the critical path and can RACE
 * gpt.js (library lands, finds an empty queue, does nothing). Only gpt.js
 * itself stays external/async.
 *
 * These are TYPED emitters: each takes typed inputs and returns the JS string
 * that an Astro `<script is:inline>` renders. Policy constants are single-
 * sourced from refresh-logic.ts; the emitted strings are covered by token
 * tests. Under a strict CSP the inline scripts carry the per-request nonce
 * (Phase 6).
 *
 * GPT API is the modern/correct form:
 *   setConfig({ singleRequest, safeFrame:{forceSafeFrame}, lazyLoad, collapseDiv?,
 *   pps? }) — NOT the deprecated enable*; NO disableInitialLoad / NO global
 *   refresh. setPublisherProvidedId / setPrivacySettings are current. Targeting
 *   (page + slot) via setConfig({ targeting }) — pubads().setTargeting /
 *   Slot.setTargeting were deprecated 2025-07-28.
 *
 * SRA batching (per GPT ad-best-practices): slots are DEFINED inline
 * (bootSlotScript — define + addService, NO display) as the parser reaches each
 * reserved div; enableServices() + a single display pass run ONCE at end of
 * <body> (bootDisplayScript). The first display() requests ALL slots defined
 * before it, so SRA roadblocks / competitive-exclusions are honored.
 * forceSafeFrame is required for cross-domain creative rendering under strict CSP
 * (content-security-policy guide).
 */

import { fullAdUnit, sortedBreakpoints, withDefaults } from './config.ts'
import {
  REFRESH_DEFAULT_CAP,
  REFRESH_DEFAULT_INTERVAL_SEC,
  REFRESH_DEFAULT_VIEWABLE_PCT,
  REFRESH_HARD_FLOOR_SEC,
} from './refresh-logic.ts'
import type { AdsSiteConfig, InterstitialTriggers, SlotProps } from './types.ts'

export const PPID_KEY = 'etus_ppid'

/**
 * JSON for embedding inside an inline <script>. JSON.stringify alone does NOT
 * neutralize the `</script>` byte sequence (it leaves `<` `>` `/` bare) and the
 * HTML parser does not decode entities inside a <script>, so we escape the
 * script-significant characters as JSON-valid \uXXXX sequences. This stops any
 * interpolated ad-config value (adUnit, targeting, pps, signals…) from breaking
 * out of the script element. Defense-in-depth: config is authored by etus, but
 * a typo/paste containing `</script>` would otherwise corrupt the page.
 */
function safeJson(value: unknown): string {
  return (JSON.stringify(value) ?? 'null').replace(
    /[<>&\u2028\u2029]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  )
}

/** (1) PPID mint — runs first, sets window.__etusPpid (no PII; frequency-cap grade). */
export function bootPpidScript(): string {
  return `(function(){try{var k=${safeJson(PPID_KEY)},id=localStorage.getItem(k);if(!id){id=(self.crypto&&crypto.randomUUID?crypto.randomUUID():Date.now()+'-'+Math.random().toString(36).slice(2));localStorage.setItem(k,id);}window.__etusPpid=id;}catch(e){}})();`
}

/** (2) Page-level GPT bootstrap — inline in <head>, before async gpt.js. */
export function bootGptScript(siteCfg: AdsSiteConfig): string {
  const cfg = withDefaults(siteCfg)
  const page: Record<string, unknown> = {
    singleRequest: cfg.singleRequest,
    // Force SafeFrame so creatives render in cross-domain iframes — required under
    // our strict-dynamic CSP (same-domain iframes inherit the page CSP and break).
    safeFrame: { forceSafeFrame: true },
    lazyLoad: {
      fetchMarginPercent: cfg.lazyLoad.fetchMarginPercent,
      renderMarginPercent: cfg.lazyLoad.renderMarginPercent,
      mobileScaling: cfg.lazyLoad.mobileScaling,
    },
  }
  if (cfg.collapseDiv) page.collapseDiv = cfg.collapseDiv
  if (cfg.pps) page.pps = cfg.pps

  const privacy: Record<string, unknown> = {}
  if (cfg.forceNpa) privacy.nonPersonalizedAds = true
  const privacyLine = Object.keys(privacy).length ? `pa.setPrivacySettings(${safeJson(privacy)});` : ''
  // Validate against the enum before interpolating it as a raw identifier (it
  // is NOT JSON-stringified), so a bad CMS value can't inject into the script.
  const ageOk =
    cfg.tagForAgeTreatment === 'UNSPECIFIED' ||
    cfg.tagForAgeTreatment === 'CHILD' ||
    cfg.tagForAgeTreatment === 'TEEN'
  const ageLine = ageOk
    ? `pa.setPrivacySettings({tagForAgeTreatment:googletag.enums.TagForAgeTreatment.${cfg.tagForAgeTreatment}});`
    : ''
  const ppidLine = cfg.enablePpid
    ? `var _p=window.__etusPpid||localStorage.getItem(${safeJson(PPID_KEY)});if(_p)pa.setPublisherProvidedId(_p);`
    : ''
  const signals = safeJson(cfg.secureSignalProviders ?? [])

  return `(function(){window.googletag=window.googletag||{cmd:[]};googletag.cmd.push(function(){
googletag.setConfig(${safeJson(page)});
var pa=googletag.pubads();
${privacyLine}${ageLine}${ppidLine}
var sp=${signals};if(sp.length){googletag.secureSignalProviders=googletag.secureSignalProviders||[];sp.forEach(function(p){if(!p.collectorFunction)return;var fn=window[p.collectorFunction];if(typeof fn!=='function')return;var o=p.id?{id:p.id,collectorFunction:fn}:{networkCode:p.networkCode,collectorFunction:fn};googletag.secureSignalProviders.push(o);});}
});})();`
}

/** (3) Per-slot DEFINE — inline right after the slot's reserved div, so the div
 *  exists and the slot defines during parse (no round-trip). NO display() here:
 *  display happens once at end of <body> (bootDisplayScript) so SRA batches all
 *  slots. Each slot registers its id in window.__etusGptSlots for that pass. */
export function bootSlotScript(networkCode: string, props: SlotProps & { id: string }): string {
  const adUnit = fullAdUnit(networkCode, props.adUnit)
  const bps = sortedBreakpoints(props.sizes)
  const defaultSizes = props.sizes[0] ?? []
  const mapping = bps.map((bp) => `m.addSize([${bp},0],${safeJson(props.sizes[bp])});`).join('')
  const targeting =
    props.targeting && Object.keys(props.targeting).length
      ? `var t=${safeJson(props.targeting)};s.setConfig({targeting:t});`
      : ''
  const refresh = props.refresh
    ? `window.__etusAdRefresh=window.__etusAdRefresh||{slots:{}};window.__etusAdRefresh.slots[${safeJson(props.id)}]=${safeJson(typeof props.refresh === 'object' ? props.refresh : {})};`
    : ''
  return `(function(){window.googletag=window.googletag||{cmd:[]};googletag.cmd.push(function(){
var s=googletag.defineSlot(${safeJson(adUnit)},${safeJson(defaultSizes)},${safeJson(props.id)});if(!s)return;
var m=googletag.sizeMapping();${mapping}s.defineSizeMapping(m.build());
${targeting}s.addService(googletag.pubads());
window.__etusGptSlots=(window.__etusGptSlots||[]);window.__etusGptSlots.push(${safeJson(props.id)});${refresh}});})();`
}

/** (3b) Single DISPLAY pass — emitted ONCE at the END of <body>, after every slot
 *  has been defined. Per GPT SRA best-practices: enableServices() runs after all
 *  defineSlot/addService, then the first display() requests ALL defined slots in a
 *  single batch (roadblocks/competitive-exclusions honored). lazyLoad still defers
 *  the actual fetch until each slot nears the viewport. */
export function bootDisplayScript(): string {
  return `(function(){window.googletag=window.googletag||{cmd:[]};googletag.cmd.push(function(){
googletag.enableServices();
(window.__etusGptSlots||[]).forEach(function(id){googletag.display(id);});
window.__etusGptReady=true;});})();`
}

/** (4) Out-of-page emitter (anchor / siderail / interstitial). */
export function bootAnchorScript(
  networkCode: string,
  adUnit: string,
  position: 'top' | 'bottom' = 'bottom',
): string {
  return oop(networkCode, adUnit, position === 'top' ? 'TOP_ANCHOR' : 'BOTTOM_ANCHOR')
}
export function bootSideRailScript(networkCode: string, adUnit: string, side: 'left' | 'right'): string {
  return oop(networkCode, adUnit, side === 'left' ? 'LEFT_SIDE_RAIL' : 'RIGHT_SIDE_RAIL')
}
export function bootInterstitialScript(
  networkCode: string,
  adUnit: string,
  triggers: InterstitialTriggers,
): string {
  const path = fullAdUnit(networkCode, adUnit)
  return `(function(){window.googletag=window.googletag||{cmd:[]};googletag.cmd.push(function(){
var s=googletag.defineOutOfPageSlot(${safeJson(path)},googletag.enums.OutOfPageFormat.INTERSTITIAL);if(!s)return;
s.setConfig({interstitial:{triggers:${safeJson(triggers)}}});s.addService(googletag.pubads());googletag.display(s);});})();`
}
function oop(networkCode: string, adUnit: string, format: string): string {
  const path = fullAdUnit(networkCode, adUnit)
  return `(function(){window.googletag=window.googletag||{cmd:[]};googletag.cmd.push(function(){
var s=googletag.defineOutOfPageSlot(${safeJson(path)},googletag.enums.OutOfPageFormat.${format});if(!s)return;
s.addService(googletag.pubads());googletag.display(s);});})();`
}

/** (5) Runtime installer — observability (etus:ad CustomEvents) + viewable
 *  refresh controller. NOT on the time-to-first-ad path; emitted once, inline,
 *  after the bootstrap. Policy constants single-sourced from refresh-logic.ts. */
export function bootRuntimeScript(): string {
  return `(function(){window.googletag=window.googletag||{cmd:[]};window.__etusAdRefresh=window.__etusAdRefresh||{slots:{}};
googletag.cmd.push(function(){var pa=googletag.pubads();
function emit(t,e){try{window.dispatchEvent(new CustomEvent('etus:ad',{detail:{type:t,slotId:e.slot.getSlotElementId(),adUnit:e.slot.getAdUnitPath(),isEmpty:e.isEmpty}}));}catch(x){}}
pa.addEventListener('slotRenderEnded',function(e){emit(e.isEmpty?'empty':'render',e);});
pa.addEventListener('slotOnload',function(e){emit('load',e);});
var view={},count={},timer={};
pa.addEventListener('slotVisibilityChanged',function(e){view[e.slot.getSlotElementId()]=e.inViewPercentage;});
pa.addEventListener('impressionViewable',function(e){var id=e.slot.getSlotElementId();emit('viewable',e);var cfg=window.__etusAdRefresh.slots[id];if(!cfg||timer[id])return;
var iv=Math.max(${REFRESH_HARD_FLOOR_SEC},cfg.intervalSec??${REFRESH_DEFAULT_INTERVAL_SEC})*1000,mv=cfg.minViewablePct??${REFRESH_DEFAULT_VIEWABLE_PCT},cap=cfg.cap??${REFRESH_DEFAULT_CAP};
timer[id]=setInterval(function(){if(document.visibilityState!=='visible')return;if((view[id]||0)<mv)return;count[id]=(count[id]||0)+1;if(count[id]>cap){clearInterval(timer[id]);return;}e.slot.setConfig({targeting:{refresh:'1'}});pa.refresh([e.slot],{changeCorrelator:false});},iv);});
});})();`
}

// AD_PRECONNECT_ORIGINS + GPT_SRC live in config.ts (single source).
export { AD_PRECONNECT_ORIGINS, GPT_SRC } from './config.ts'
