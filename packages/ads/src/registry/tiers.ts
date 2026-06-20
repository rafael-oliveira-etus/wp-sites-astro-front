/**
 * Ad TIERS — premium-first (research/11-platform-redesign.md §3.2).
 *
 * The tier NUMBER is NOT a render order. Under SRA every eager slot defined
 * before the request batches into ONE request regardless of order — so a
 * client-side priority sort would be decorative. Instead a tier selects a real
 * LOADING BEHAVIOR: fetch timing (eager → first SRA batch vs lazy → deferred),
 * per-slot collapse, and refresh-eligibility. FORMAT (in-page vs out-of-page) is
 * a property of the placement TYPE (catalog.ts), not the tier — an anchor is
 * TopOfPage-tier but out-of-page. Server-side fill priority lives in GAM
 * line-item priority, not here. Pure + unit-tested.
 */

/** Premium-first tiers. Lower number = higher priority. */
export enum AdTier {
  Interstitial = 0,
  TopOfPage = 1,
  Hero = 2,
  AboveFold = 3,
  Sidebar = 4,
  InContent = 5,
  LowValue = 6,
}

export type FetchMode = 'eager' | 'lazy'
export type CollapsePolicy = 'never' | 'on-no-fill'

/** The real GPT mechanics a tier maps to (NOT an order). */
export type TierBehavior = {
  /** eager → display() at parse → joins the FIRST SRA batch; lazy → deferred
   *  (native page-level lazyLoad, or an opt-in observer for per-tier margins). */
  fetch: FetchMode
  /** per-slot collapse (slot.setConfig({ collapseDiv })). Premium reserves space
   *  (CLS 0); only low-value fillers collapse on no-fill. */
  collapse: CollapsePolicy
  /** viewable auto-refresh allowed (the runtime refreshes ONLY eligible tiers,
   *  ≥30s, ≥viewable% — and you MUST declare refreshed inventory in GAM). */
  refreshEligible: boolean
}

/** Tier → behavior. The DEFAULTS encode GPT best practice so a new placement is
 *  correct with zero tuning; a placement may override individual fields. */
export const TIER_BEHAVIOR: Record<AdTier, TierBehavior> = {
  [AdTier.Interstitial]: { fetch: 'eager', collapse: 'never', refreshEligible: false },
  [AdTier.TopOfPage]: { fetch: 'eager', collapse: 'never', refreshEligible: true },
  [AdTier.Hero]: { fetch: 'eager', collapse: 'never', refreshEligible: true },
  [AdTier.AboveFold]: { fetch: 'eager', collapse: 'never', refreshEligible: true },
  [AdTier.Sidebar]: { fetch: 'lazy', collapse: 'never', refreshEligible: true },
  [AdTier.InContent]: { fetch: 'lazy', collapse: 'never', refreshEligible: true },
  [AdTier.LowValue]: { fetch: 'lazy', collapse: 'on-no-fill', refreshEligible: false },
}
