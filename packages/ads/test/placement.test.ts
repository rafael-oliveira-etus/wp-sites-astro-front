import { describe, expect, it } from 'vitest'
import {
  injectAdMarkers,
  oopPlacements,
  placementApplies,
  resolveInContent,
  resolveIndices,
} from '../src/placement.ts'
import type { PlacementContext, ResolvedInjection } from '../src/placement.ts'
import type { PlacementRule } from '../src/types.ts'

const rule = (over: Partial<PlacementRule>): PlacementRule => ({
  id: 'r',
  position: 'after-paragraph',
  enabled: true,
  adUnit: 'post/in-content',
  ...over,
})

const ctx = (over: Partial<PlacementContext> = {}): PlacementContext => ({
  paragraphCount: 10,
  wordCount: 800,
  deviceClass: 'mobile',
  ...over,
})

describe('resolveIndices', () => {
  it('1-based positive → 0-based', () => {
    expect(resolveIndices(rule({ index: 2 }), 5)).toEqual([1])
  })
  it('negative counts from the end', () => {
    expect(resolveIndices(rule({ index: -1 }), 5)).toEqual([4])
    expect(resolveIndices(rule({ index: -2 }), 5)).toEqual([3])
  })
  it('array → multiple, sorted + deduped', () => {
    expect(resolveIndices(rule({ index: [3, 1, 3] }), 5)).toEqual([0, 2])
  })
  it('every Nth paragraph', () => {
    expect(resolveIndices(rule({ every: 3 }), 10)).toEqual([2, 5, 8])
  })
  it('clamps out-of-range + handles empty', () => {
    expect(resolveIndices(rule({ index: 99 }), 5)).toEqual([4])
    expect(resolveIndices(rule({ index: 2 }), 0)).toEqual([])
  })
  it('ignores index 0 (not a valid 1-based index) instead of mapping to the last paragraph', () => {
    expect(resolveIndices(rule({ index: 0 }), 5)).toEqual([])
    expect(resolveIndices(rule({ index: [0, 2] }), 5)).toEqual([1])
  })
})

describe('placementApplies', () => {
  it('false when disabled', () => {
    expect(placementApplies(rule({ enabled: false }), ctx())).toBe(false)
  })
  it('device-gates', () => {
    expect(placementApplies(rule({ devices: ['desktop'] }), ctx({ deviceClass: 'mobile' }))).toBe(false)
    expect(placementApplies(rule({ devices: ['mobile'] }), ctx({ deviceClass: 'mobile' }))).toBe(true)
  })
  it('honors where-guards', () => {
    expect(placementApplies(rule({ where: { minWords: 1000 } }), ctx({ wordCount: 800 }))).toBe(false)
    expect(placementApplies(rule({ where: { minParagraphs: 12 } }), ctx({ paragraphCount: 10 }))).toBe(false)
    expect(placementApplies(rule({ where: { collections: ['guides'] } }), ctx({ collection: 'posts' }))).toBe(false)
    expect(placementApplies(rule({ where: { tags: ['seo'] } }), ctx({ tags: ['ads', 'seo'] }))).toBe(true)
  })
  it('treats an empty where.collections / where.tags as no constraint (symmetric)', () => {
    expect(placementApplies(rule({ where: { collections: [] } }), ctx({ collection: 'posts' }))).toBe(true)
    expect(placementApplies(rule({ where: { collections: [] } }), ctx())).toBe(true)
    expect(placementApplies(rule({ where: { tags: [] } }), ctx())).toBe(true)
  })
})

describe('resolveInContent', () => {
  it('respects maxPerPost', () => {
    const out = resolveInContent([rule({ every: 2, maxPerPost: 2 })], ctx({ paragraphCount: 10 }))
    expect(out).toHaveLength(2)
    expect(out.map((r) => r.paragraphIndex)).toEqual([1, 3])
  })
  it('content edges have null paragraphIndex', () => {
    const out = resolveInContent([rule({ position: 'after-content' })], ctx())
    expect(out[0]?.paragraphIndex).toBeNull()
  })
  it('skips non-applicable + out-of-page rules', () => {
    const out = resolveInContent(
      [rule({ enabled: false }), rule({ position: 'anchor' }), rule({ index: 2 })],
      ctx(),
    )
    expect(out).toHaveLength(1)
    expect(out[0]?.paragraphIndex).toBe(1)
  })
  it('resolves a negative + array index then caps with maxPerPost (lowest indices kept)', () => {
    const out = resolveInContent(
      [rule({ position: 'after-paragraph', index: [-1, 5, 2], maxPerPost: 2 })],
      ctx({ paragraphCount: 10 }),
    )
    expect(out.map((r) => r.paragraphIndex)).toEqual([1, 4])
  })
})

describe('oopPlacements', () => {
  it('returns applicable out-of-page rules only', () => {
    const out = oopPlacements(
      [rule({ position: 'anchor' }), rule({ position: 'siderail-left', devices: ['desktop'] }), rule({ index: 2 })],
      ctx({ deviceClass: 'mobile' }),
    )
    expect(out.map((r) => r.position)).toEqual(['anchor']) // siderail desktop-gated out on mobile
  })
})

describe('injectAdMarkers (format-agnostic)', () => {
  // Mock content: 'p' = paragraph, 'h' = heading (non-paragraph).
  const items = ['p', 'h', 'p', 'p', 'h', 'p'] // 4 paragraphs at item indices 0,2,3,5
  const isPara = (i: string) => i === 'p'
  const marker = (inj: ResolvedInjection) => `AD(${inj.position}:${inj.paragraphIndex})`

  it('inserts after the k-th paragraph (not item index)', () => {
    const inj: ResolvedInjection[] = [{ rule: rule({}), position: 'after-paragraph', paragraphIndex: 1 }]
    // after the 2nd paragraph (k=1, which is item index 2)
    expect(injectAdMarkers(items, isPara, marker, inj)).toEqual([
      'p', 'h', 'p', 'AD(after-paragraph:1)', 'p', 'h', 'p',
    ])
  })

  it('handles before/after-content at the edges', () => {
    const inj: ResolvedInjection[] = [
      { rule: rule({}), position: 'before-content', paragraphIndex: null },
      { rule: rule({}), position: 'after-content', paragraphIndex: null },
    ]
    const out = injectAdMarkers(items, isPara, marker, inj)
    expect(out[0]).toBe('AD(before-content:null)')
    expect(out[out.length - 1]).toBe('AD(after-content:null)')
  })

  it('never injects inside non-paragraph nodes (headings pass through)', () => {
    const inj: ResolvedInjection[] = [{ rule: rule({}), position: 'after-paragraph', paragraphIndex: 0 }]
    const out = injectAdMarkers(items, isPara, marker, inj)
    // marker lands right after the 1st paragraph (item 0), before the heading
    expect(out).toEqual(['p', 'AD(after-paragraph:0)', 'h', 'p', 'p', 'h', 'p'])
  })

  it('inserts a before-paragraph marker immediately before the k-th paragraph', () => {
    const inj: ResolvedInjection[] = [{ rule: rule({}), position: 'before-paragraph', paragraphIndex: 1 }]
    // before the 2nd paragraph (k=1 = item index 2, after the heading)
    expect(injectAdMarkers(items, isPara, marker, inj)).toEqual([
      'p', 'h', 'AD(before-paragraph:1)', 'p', 'p', 'h', 'p',
    ])
  })

  it('places multiple markers by paragraph index, order-independent (no k-shift bug)', () => {
    const a: ResolvedInjection = { rule: rule({}), position: 'after-paragraph', paragraphIndex: 0 }
    const b: ResolvedInjection = { rule: rule({}), position: 'after-paragraph', paragraphIndex: 2 }
    const expected = ['p', 'AD(after-paragraph:0)', 'h', 'p', 'p', 'AD(after-paragraph:2)', 'h', 'p']
    expect(injectAdMarkers(items, isPara, marker, [a, b])).toEqual(expected)
    expect(injectAdMarkers(items, isPara, marker, [b, a])).toEqual(expected) // array order must not matter
  })
})
