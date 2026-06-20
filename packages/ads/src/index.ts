// Public SERVER API: types, pure helpers, and the INLINE script emitters that
// the Astro components render via `<script is:inline set:html={…}>`.

export type { ResolvedAdsConfig } from './config.ts'
export {
  AD_PRECONNECT_ORIGINS,
  effectiveNetworkCode,
  fullAdUnit,
  GPT_SRC,
  sortedBreakpoints,
  TEST_NETWORK_CODE,
  withDefaults,
} from './config.ts'
export {
  cfDeviceTypeToClass,
  DEVICE_BREAKPOINTS,
  resolveDeviceClass,
  slotAllowed,
  uaToDeviceClass,
  viewportDeviceClass,
} from './device.ts'
// Inline script emitters (Phase 3 — the bootstrap ships inline in <head>).
export {
  bootAnchorScript,
  bootDisplayScript,
  bootGptScript,
  bootInterstitialScript,
  bootPpidScript,
  bootRuntimeScript,
  bootSideRailScript,
  bootSlotScript,
  PPID_KEY,
} from './emit.ts'
// Ad-Inserter-style placement resolution (pure; format-agnostic core).
export type { PlacementContext, ResolvedInjection } from './placement.ts'
export {
  injectAdMarkers,
  isInContentPosition,
  oopPlacements,
  placementApplies,
  resolveInContent,
  resolveIndices,
} from './placement.ts'

export {
  clampIntervalSec,
  REFRESH_DEFAULT_CAP,
  REFRESH_DEFAULT_INTERVAL_SEC,
  REFRESH_DEFAULT_VIEWABLE_PCT,
  REFRESH_HARD_FLOOR_SEC,
  resolveRefresh,
  shouldRefresh,
} from './refresh-logic.ts'
export type { AdFormat, AdPlacementType, OopFormat, PlacementTypeDef } from './registry/catalog.ts'
export { PLACEMENT_CATALOG } from './registry/catalog.ts'
export type {
  AdContext,
  AdPlacement,
  AdPlan,
  LoadingStrategy,
  ResolvedSlot,
  RouteType,
} from './registry/plan.ts'
export { placementTier, resolveAdPlan, resolveStrategy } from './registry/resolve.ts'
export type { CollapsePolicy, FetchMode, TierBehavior } from './registry/tiers.ts'
// Ad registry — the config-driven platform core (research/11-platform-redesign.md §3).
// Priority = real GPT mechanics (tier → loading behavior), not a sort key.
export { AdTier, TIER_BEHAVIOR } from './registry/tiers.ts'
// Reserved-height helpers + the Mode-B device CSV parser.
export { parseDevices, reserveHeightStyle, reserveMediaCss } from './serialize.ts'
export type {
  AdsMode,
  AdsSiteConfig,
  AnchorProps,
  CollapseDiv,
  DeviceClass,
  InterstitialProps,
  InterstitialTriggers,
  PlacementPosition,
  PlacementRule,
  PlacementWhere,
  PpsConfig,
  RefreshConfig,
  ReserveMap,
  SecureSignalProvider,
  SideRailProps,
  SizeMap,
  Sizing,
  SlotProps,
  SlotSize,
  TagForAgeTreatment,
} from './types.ts'
