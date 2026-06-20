/**
 * resolveAdPlan — the PURE heart of the ad platform. Given a site's placement
 * instances + the request context, it produces the premium-first AdPlan: which
 * slots run, each with its resolved loading strategy + targeting, plus page-level
 * targeting. ALL gating is data (route/geo/locale/device/where) — so onboarding
 * "no interstitial in DE" or "extra in-content for BR mobile" is a config row,
 * never a code branch. research/11-platform-redesign.md §3.4. Unit-tested.
 */
import { slotAllowed } from '../device.ts'
import { PLACEMENT_CATALOG } from './catalog.ts'
import type { AdContext, AdPlacement, AdPlan, LoadingStrategy, ResolvedSlot } from './plan.ts'
import { AdTier, TIER_BEHAVIOR } from './tiers.ts'

/** The effective tier for a placement (explicit override → catalog default). */
export function placementTier(p: AdPlacement): AdTier {
  return p.tier ?? PLACEMENT_CATALOG[p.type].tier
}

/** Resolve a placement's loading strategy: tier BEHAVIOR + type FORMAT (+ oop),
 *  with any per-placement override applied last. */
export function resolveStrategy(p: AdPlacement): LoadingStrategy {
  const def = PLACEMENT_CATALOG[p.type]
  const behavior = TIER_BEHAVIOR[placementTier(p)]
  const base: LoadingStrategy = {
    format: def.format,
    fetch: behavior.fetch,
    collapse: behavior.collapse,
    refreshEligible: behavior.refreshEligible,
  }
  if (def.format === 'out-of-page' && def.oopFormat) base.oop = { format: def.oopFormat }
  return { ...base, ...p.strategy }
}

/** Does this placement run on this request? enabled + device + data-driven gating. */
export function placementApplies(p: AdPlacement, ctx: AdContext): boolean {
  if (!p.enabled) return false
  if (!slotAllowed(p.devices, ctx.device)) return false
  const w = p.where
  if (!w) return true
  if (w.routes?.length && !w.routes.includes(ctx.routeType)) return false
  if (w.geos?.length && (!ctx.geo || !w.geos.includes(ctx.geo))) return false
  if (w.locales?.length && !w.locales.includes(ctx.locale)) return false
  const facts = ctx.postFacts
  if (w.tags?.length && !(facts?.tags ?? []).some((t) => w.tags?.includes(t))) return false
  if (w.minParagraphs != null && (facts?.paragraphCount ?? 0) < w.minParagraphs) return false
  if (w.minWords != null && (facts?.wordCount ?? 0) < w.minWords) return false
  return true
}

function toResolvedSlot(p: AdPlacement): ResolvedSlot {
  const tier = placementTier(p)
  const def = PLACEMENT_CATALOG[p.type]
  return {
    id: p.id,
    type: p.type,
    tier,
    adUnit: p.adUnit,
    sizes: p.sizes ?? def.defaultSizes ?? {},
    reserve: p.reserve ?? {},
    devices: p.devices,
    refresh: p.refresh,
    strategy: resolveStrategy(p),
    // Slot-level KV: position(=type) + tier name + author-supplied targeting.
    targeting: { pos: p.type, tier: AdTier[tier], ...(p.targeting ?? {}) },
    position: p.position,
    index: p.index,
    every: p.every,
    maxPerPost: p.maxPerPost,
  }
}

/** Page-level GAM targeting from the request context. */
function buildPageTargeting(ctx: AdContext): Record<string, string | string[]> {
  const t: Record<string, string | string[]> = {
    route: ctx.routeType,
    locale: ctx.locale,
    device: ctx.device,
  }
  if (ctx.geo) t.country = ctx.geo
  if (ctx.postFacts?.vertical) t.vertical = ctx.postFacts.vertical
  return t
}

/**
 * Resolve the full ad plan for a page. Filters by eligibility, resolves each
 * slot's strategy + targeting, and orders premium-first (lower tier number wins;
 * stable within a tier). In-content geometry (position/index/every) is passed
 * through on each slot for the downstream content adapter to expand via the
 * existing resolveInContent/injectAdMarkers engine.
 */
export function resolveAdPlan(placements: AdPlacement[], ctx: AdContext): AdPlan {
  const slots = placements
    .filter((p) => placementApplies(p, ctx))
    .map(toResolvedSlot)
    .sort((a, b) => a.tier - b.tier)
  return { slots, pageTargeting: buildPageTargeting(ctx) }
}
