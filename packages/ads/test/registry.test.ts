import { describe, expect, it } from 'vitest'
import { PLACEMENT_CATALOG } from '../src/registry/catalog.ts'
import type { AdContext, AdPlacement } from '../src/registry/plan.ts'
import { placementApplies, placementTier, resolveAdPlan, resolveStrategy } from '../src/registry/resolve.ts'
import { AdTier, TIER_BEHAVIOR } from '../src/registry/tiers.ts'

const place = (over: Partial<AdPlacement> & Pick<AdPlacement, 'id' | 'type'>): AdPlacement => ({
  enabled: true,
  adUnit: 'unit',
  ...over,
})
const ctx = (over: Partial<AdContext> = {}): AdContext => ({
  routeType: 'article',
  device: 'mobile',
  geo: 'BR',
  locale: 'pt-BR',
  ...over,
})

describe('TIER_BEHAVIOR (priority = real mechanics, not a sort key)', () => {
  it('premium tiers fetch eagerly + reserve; low-value defers + collapses', () => {
    expect(TIER_BEHAVIOR[AdTier.TopOfPage]).toEqual({
      fetch: 'eager',
      collapse: 'never',
      refreshEligible: true,
    })
    expect(TIER_BEHAVIOR[AdTier.LowValue]).toEqual({
      fetch: 'lazy',
      collapse: 'on-no-fill',
      refreshEligible: false,
    })
  })
})

describe('PLACEMENT_CATALOG', () => {
  it('anchors are OOP (TopOfPage tier); in-content is in-page (InContent tier); interstitial is top tier', () => {
    expect(PLACEMENT_CATALOG.anchor).toMatchObject({
      tier: AdTier.TopOfPage,
      format: 'out-of-page',
      oopFormat: 'bottom-anchor',
    })
    expect(PLACEMENT_CATALOG['in-content']).toMatchObject({ tier: AdTier.InContent, format: 'in-page' })
    expect(PLACEMENT_CATALOG['in-content'].defaultSizes).toBeDefined()
    expect(PLACEMENT_CATALOG.interstitial).toMatchObject({
      tier: AdTier.Interstitial,
      format: 'out-of-page',
      oopFormat: 'interstitial',
    })
  })
})

describe('resolveStrategy (tier behavior + type format, override last)', () => {
  it('in-content → in-page, lazy, no oop', () => {
    expect(resolveStrategy(place({ id: 'a', type: 'in-content' }))).toEqual({
      format: 'in-page',
      fetch: 'lazy',
      collapse: 'never',
      refreshEligible: true,
    })
  })
  it('anchor → out-of-page + the GAM oop format, eager', () => {
    const s = resolveStrategy(place({ id: 'b', type: 'anchor' }))
    expect(s).toMatchObject({ format: 'out-of-page', fetch: 'eager', oop: { format: 'bottom-anchor' } })
  })
  it('a per-placement strategy override wins', () => {
    expect(
      resolveStrategy(place({ id: 'c', type: 'in-content', strategy: { collapse: 'on-no-fill' } })).collapse,
    ).toBe('on-no-fill')
  })
  it('a tier override re-derives the behavior', () => {
    expect(resolveStrategy(place({ id: 'd', type: 'in-content', tier: AdTier.TopOfPage })).fetch).toBe(
      'eager',
    )
    expect(placementTier(place({ id: 'd', type: 'in-content', tier: AdTier.TopOfPage }))).toBe(
      AdTier.TopOfPage,
    )
  })
})

describe('placementApplies (all gating is DATA, not code branches)', () => {
  it('respects enabled + device', () => {
    expect(placementApplies(place({ id: 'a', type: 'in-content', enabled: false }), ctx())).toBe(false)
    expect(
      placementApplies(place({ id: 'b', type: 'sidebar', devices: ['desktop'] }), ctx({ device: 'mobile' })),
    ).toBe(false)
    expect(
      placementApplies(place({ id: 'b', type: 'sidebar', devices: ['desktop'] }), ctx({ device: 'desktop' })),
    ).toBe(true)
  })
  it('gates by route / geo / locale', () => {
    const p = place({
      id: 'r',
      type: 'top-banner',
      where: { routes: ['article'], geos: ['BR'], locales: ['pt-BR'] },
    })
    expect(placementApplies(p, ctx())).toBe(true)
    expect(placementApplies(p, ctx({ routeType: 'home' }))).toBe(false)
    expect(placementApplies(p, ctx({ geo: 'US' }))).toBe(false)
    expect(placementApplies(p, ctx({ geo: null }))).toBe(false)
    expect(placementApplies(p, ctx({ locale: 'en' }))).toBe(false)
  })
  it('gates by tags / minWords from postFacts', () => {
    const p = place({ id: 'w', type: 'in-content', where: { tags: ['finance'], minWords: 500 } })
    expect(
      placementApplies(p, ctx({ postFacts: { paragraphCount: 9, wordCount: 600, tags: ['finance'] } })),
    ).toBe(true)
    expect(
      placementApplies(p, ctx({ postFacts: { paragraphCount: 9, wordCount: 600, tags: ['sports'] } })),
    ).toBe(false)
    expect(
      placementApplies(p, ctx({ postFacts: { paragraphCount: 9, wordCount: 100, tags: ['finance'] } })),
    ).toBe(false)
  })
})

describe('resolveAdPlan', () => {
  it('filters ineligible placements and orders the rest premium-first', () => {
    const placements: AdPlacement[] = [
      place({ id: 'mid', type: 'in-content' }), // tier 5
      place({ id: 'inter', type: 'interstitial' }), // tier 0
      place({ id: 'top', type: 'top-banner' }), // tier 1
      place({ id: 'home-only', type: 'hero', where: { routes: ['home'] } }), // excluded on article
    ]
    const plan = resolveAdPlan(placements, ctx())
    expect(plan.slots.map((s) => s.id)).toEqual(['inter', 'top', 'mid'])
  })

  it('fills sizes from the catalog when a placement omits them', () => {
    const plan = resolveAdPlan([place({ id: 'a', type: 'in-content' })], ctx())
    const [slot] = plan.slots
    expect(slot?.sizes).toEqual(PLACEMENT_CATALOG['in-content'].defaultSizes)
  })

  it('attaches slot targeting (pos + tier) and builds page targeting', () => {
    const plan = resolveAdPlan(
      [place({ id: 'a', type: 'top-banner', targeting: { promo: 'x' } })],
      ctx({ postFacts: { paragraphCount: 5, wordCount: 800, vertical: 'cc' } }),
    )
    const [slot] = plan.slots
    expect(slot?.targeting).toEqual({ pos: 'top-banner', tier: 'TopOfPage', promo: 'x' })
    expect(plan.pageTargeting).toEqual({
      route: 'article',
      locale: 'pt-BR',
      device: 'mobile',
      country: 'BR',
      vertical: 'cc',
    })
  })

  it('omits country when geo is null', () => {
    expect(resolveAdPlan([], ctx({ geo: null })).pageTargeting).not.toHaveProperty('country')
  })
})
