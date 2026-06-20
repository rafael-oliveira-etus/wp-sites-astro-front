/**
 * Placement TYPE catalog — the 11 placement types (the product vocabulary) and
 * their defaults: tier, format (in-page vs out-of-page), the GAM OOP format, and
 * a size archetype used when a placement omits its own sizes. This is the
 * code-owned half of the hybrid registry (per-site INSTANCES live in config);
 * editing inventory shape happens here, once, not scattered across components.
 * research/11-platform-redesign.md §3.1. Pure + unit-tested.
 */
import type { SizeMap } from '../types.ts'
import { AdTier } from './tiers.ts'

/** The 11 placement types. `rewarded` is typed/future-ready (not rendered v1). */
export type AdPlacementType =
  | 'top-banner'
  | 'hero'
  | 'in-content'
  | 'sidebar'
  | 'sticky-sidebar'
  | 'sticky-footer'
  | 'anchor'
  | 'interstitial'
  | 'rewarded'
  | 'native'
  | 'related-content'

export type AdFormat = 'in-page' | 'out-of-page'

/** The GAM out-of-page formats we drive (subset of GPT OutOfPageFormat). */
export type OopFormat =
  | 'top-anchor'
  | 'bottom-anchor'
  | 'left-rail'
  | 'right-rail'
  | 'interstitial'
  | 'rewarded'

export type PlacementTypeDef = {
  tier: AdTier
  format: AdFormat
  /** required when format === 'out-of-page'. */
  oopFormat?: OopFormat
  /** default sizes for in-page types when a placement omits its own. */
  defaultSizes?: SizeMap
}

// Size archetypes (mobile-first: ~90% mobile, BR — see gotallcards profile).
const RECT: SizeMap = { 0: [[300, 250], 'fluid'], 768: [[300, 250], [336, 280], 'fluid'] }
const LEADER: SizeMap = { 0: [[320, 100], 'fluid'], 768: [[728, 90], [970, 90], 'fluid'] }
const HERO: SizeMap = { 0: [[300, 250], 'fluid'], 768: [[970, 250], [728, 90], 'fluid'] }
const RAIL: SizeMap = {
  1024: [
    [300, 600],
    [300, 250],
  ],
}
const FLUID: SizeMap = { 0: ['fluid'] }

export const PLACEMENT_CATALOG: Record<AdPlacementType, PlacementTypeDef> = {
  'top-banner': { tier: AdTier.TopOfPage, format: 'in-page', defaultSizes: LEADER },
  hero: { tier: AdTier.Hero, format: 'in-page', defaultSizes: HERO },
  'in-content': { tier: AdTier.InContent, format: 'in-page', defaultSizes: RECT },
  sidebar: {
    tier: AdTier.Sidebar,
    format: 'in-page',
    defaultSizes: {
      0: [[300, 250]],
      1024: [
        [300, 600],
        [300, 250],
      ],
    },
  },
  'sticky-sidebar': { tier: AdTier.Sidebar, format: 'in-page', defaultSizes: RAIL },
  // sticky-footer & anchor are GAM-managed OOP anchors (top mobile yield).
  'sticky-footer': { tier: AdTier.TopOfPage, format: 'out-of-page', oopFormat: 'bottom-anchor' },
  anchor: { tier: AdTier.TopOfPage, format: 'out-of-page', oopFormat: 'bottom-anchor' },
  interstitial: { tier: AdTier.Interstitial, format: 'out-of-page', oopFormat: 'interstitial' },
  rewarded: { tier: AdTier.Interstitial, format: 'out-of-page', oopFormat: 'rewarded' },
  native: { tier: AdTier.InContent, format: 'in-page', defaultSizes: FLUID },
  'related-content': { tier: AdTier.LowValue, format: 'in-page', defaultSizes: FLUID },
}
