/**
 * Ad PLAN types — the resolved, ready-to-emit output of resolveAdPlan, plus the
 * per-site placement instance + the request context that feed it.
 * research/11-platform-redesign.md §3.3. Pure types only.
 */
import type { DeviceClass, PlacementPosition, RefreshConfig, ReserveMap, SizeMap } from '../types.ts'
import type { AdFormat, AdPlacementType, OopFormat } from './catalog.ts'
import type { AdTier, CollapsePolicy, FetchMode } from './tiers.ts'

/** Page/route types the blog serves — drives placement gating + page targeting. */
export type RouteType = 'home' | 'list' | 'category' | 'tag' | 'author' | 'article' | 'search'

/** Request + page facts the resolver needs (built per request in apps/web). */
export type AdContext = {
  routeType: RouteType
  device: DeviceClass
  geo: string | null
  locale: string
  /** Article facts (article routes only) — drive in-content geometry + min* guards. */
  postFacts?: { paragraphCount: number; wordCount: number; vertical?: string; tags?: string[] }
}

/** Config-driven gating — all DATA, so onboarding a route/geo/locale rule is a
 *  config edit, never a component conditional. */
export type PlacementWhere = {
  routes?: RouteType[]
  geos?: string[]
  locales?: string[]
  tags?: string[]
  minParagraphs?: number
  minWords?: number
}

/** A resolved per-slot loading strategy: the tier behavior + the type's format. */
export type LoadingStrategy = {
  format: AdFormat
  fetch: FetchMode
  collapse: CollapsePolicy
  refreshEligible: boolean
  /** present iff format === 'out-of-page'. */
  oop?: { format: OopFormat }
}

/**
 * A per-site placement INSTANCE (the hybrid registry's editable half). Adds a
 * placement TYPE (→ catalog defaults) + route/geo/locale gating + an optional
 * strategy override to the in-content geometry fields the existing engine reuses.
 */
export type AdPlacement = {
  id: string
  type: AdPlacementType
  /** Override the catalog tier (rare). */
  tier?: AdTier
  enabled: boolean
  adUnit: string
  /** in-content geometry (consumed downstream by resolveInContent/injectAdMarkers). */
  position?: PlacementPosition
  index?: number | number[]
  every?: number
  maxPerPost?: number
  devices?: DeviceClass[]
  sizes?: SizeMap
  reserve?: ReserveMap
  refresh?: boolean | RefreshConfig
  targeting?: Record<string, string | string[]>
  where?: PlacementWhere
  /** Per-placement loading-strategy override (merged onto the tier behavior). */
  strategy?: Partial<LoadingStrategy>
}

/** A resolved, ready-to-emit slot. */
export type ResolvedSlot = {
  id: string
  type: AdPlacementType
  tier: AdTier
  adUnit: string
  sizes: SizeMap
  reserve: ReserveMap
  devices?: DeviceClass[]
  refresh?: boolean | RefreshConfig
  strategy: LoadingStrategy
  targeting: Record<string, string | string[]>
  /** in-content geometry passthrough (null/undefined for OOP). */
  position?: PlacementPosition
  index?: number | number[]
  every?: number
  maxPerPost?: number
}

/** The full ad plan for one page render. `slots` is ordered premium-first. */
export type AdPlan = {
  slots: ResolvedSlot[]
  /** page-level GAM targeting (route/locale/device/country/vertical). */
  pageTargeting: Record<string, string | string[]>
}
