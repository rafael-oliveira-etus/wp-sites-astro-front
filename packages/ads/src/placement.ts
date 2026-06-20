/**
 * PURE placement-resolution logic (Ad-Inserter-style). Format-agnostic: it
 * decides WHERE ads go given PlacementRule[] + post facts. The content adapter
 * (rehype for MDX / a Lexical node-walker for Payload) consumes the result
 * and does the actual injection. No DOM, no content parsing — unit-tested.
 */
import type { DeviceClass, PlacementPosition, PlacementRule } from './types.ts'
import { slotAllowed } from './device.ts'

/** Post facts the adapter measures and passes in. */
export type PlacementContext = {
  paragraphCount: number
  wordCount: number
  collection?: string
  tags?: string[]
  deviceClass: DeviceClass
}

/** A resolved injection point. */
export type ResolvedInjection = {
  rule: PlacementRule
  position: PlacementPosition
  /** 0-based paragraph index for paragraph positions; null for content edges. */
  paragraphIndex: number | null
}

export function isInContentPosition(p: PlacementPosition): boolean {
  return (
    p === 'before-content' || p === 'after-content' || p === 'before-paragraph' || p === 'after-paragraph'
  )
}

/** Does a rule apply to this post? (enabled + device + where-guards) */
export function placementApplies(rule: PlacementRule, ctx: PlacementContext): boolean {
  if (!rule.enabled) return false
  if (!slotAllowed(rule.devices, ctx.deviceClass)) return false
  const w = rule.where
  if (w) {
    if (w.collections && w.collections.length && (!ctx.collection || !w.collections.includes(ctx.collection)))
      return false
    if (w.tags && w.tags.length && !(ctx.tags ?? []).some((t) => w.tags?.includes(t))) return false
    if (w.minParagraphs != null && ctx.paragraphCount < w.minParagraphs) return false
    if (w.minWords != null && ctx.wordCount < w.minWords) return false
  }
  return true
}

/**
 * Resolve a rule's index/every spec to sorted, deduped, clamped 0-based
 * paragraph indices. Index is 1-based; negative counts from the end
 * (-1 = last paragraph). `every` overrides `index`.
 */
export function resolveIndices(rule: PlacementRule, count: number): number[] {
  if (count <= 0) return []
  const clamp = (i: number) => Math.max(0, Math.min(count - 1, i))
  // 1-based spec → 0-based index; negatives count from the end (-1 = last). 0 is
  // not a valid 1-based index, so it is ignored rather than silently resolving
  // to the last paragraph.
  const toZero = (spec: number): number | null =>
    spec === 0 ? null : spec >= 1 ? spec - 1 : count + spec

  let raw: number[]
  if (rule.every && rule.every > 0) {
    raw = []
    for (let n = rule.every; n <= count; n += rule.every) raw.push(n - 1)
  } else if (Array.isArray(rule.index)) {
    raw = rule.index.map(toZero).filter((n): n is number => n !== null)
  } else if (typeof rule.index === 'number') {
    const z = toZero(rule.index)
    raw = z === null ? [] : [z]
  } else {
    raw = []
  }
  return [...new Set(raw.map(clamp))].sort((a, b) => a - b)
}

/** Resolve all IN-CONTENT injections (content edges + paragraph positions),
 *  honoring guards + per-rule maxPerPost. */
export function resolveInContent(rules: PlacementRule[], ctx: PlacementContext): ResolvedInjection[] {
  const out: ResolvedInjection[] = []
  for (const rule of rules) {
    if (!isInContentPosition(rule.position)) continue
    if (!placementApplies(rule, ctx)) continue
    if (rule.position === 'before-content' || rule.position === 'after-content') {
      out.push({ rule, position: rule.position, paragraphIndex: null })
      continue
    }
    let idxs = resolveIndices(rule, ctx.paragraphCount)
    if (rule.maxPerPost != null) idxs = idxs.slice(0, rule.maxPerPost)
    for (const i of idxs) out.push({ rule, position: rule.position, paragraphIndex: i })
  }
  return out
}

/** The applicable out-of-page placements (anchor / siderail / interstitial). */
export function oopPlacements(rules: PlacementRule[], ctx: PlacementContext): PlacementRule[] {
  return rules.filter((r) => !isInContentPosition(r.position) && placementApplies(r, ctx))
}

/**
 * Generic, PURE injection: insert ad-marker items into a content item array at
 * the resolved positions. Content-format-agnostic — the caller provides:
 *   - `isParagraph(item)`: whether an item counts as a paragraph (top-level
 *      <p> for HAST, `{_type:'block', style:'normal'}` for Portable Text)
 *   - `makeMarker(inj)`: build a marker item for an injection (the ad node)
 * before/after-content markers go at the array edges; before/after-paragraph at
 * the k-th paragraph. This is the shared core both adapters reuse — unit-tested.
 */
export function injectAdMarkers<T>(
  items: T[],
  isParagraph: (item: T) => boolean,
  makeMarker: (inj: ResolvedInjection) => T,
  injections: ResolvedInjection[],
): T[] {
  const before = injections.filter((i) => i.position === 'before-content').map(makeMarker)
  const after = injections.filter((i) => i.position === 'after-content').map(makeMarker)

  const beforePara = new Map<number, ResolvedInjection[]>()
  const afterPara = new Map<number, ResolvedInjection[]>()
  for (const inj of injections) {
    if (inj.paragraphIndex == null) continue
    const map = inj.position === 'before-paragraph' ? beforePara : inj.position === 'after-paragraph' ? afterPara : null
    if (!map) continue
    const arr = map.get(inj.paragraphIndex) ?? []
    arr.push(inj)
    map.set(inj.paragraphIndex, arr)
  }

  const out: T[] = [...before]
  let k = -1
  for (const item of items) {
    if (isParagraph(item)) {
      k++
      for (const inj of beforePara.get(k) ?? []) out.push(makeMarker(inj))
      out.push(item)
      for (const inj of afterPara.get(k) ?? []) out.push(makeMarker(inj))
    } else {
      out.push(item)
    }
  }
  out.push(...after)
  return out
}
