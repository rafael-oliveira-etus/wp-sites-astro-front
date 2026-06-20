import { describe, expect, it } from 'vitest'
import {
  REFRESH_DEFAULT_CAP,
  REFRESH_HARD_FLOOR_SEC,
  clampIntervalSec,
  resolveRefresh,
  shouldRefresh,
} from '../src/refresh-logic.ts'

describe('clampIntervalSec', () => {
  it('defaults to 60s', () => {
    expect(clampIntervalSec(undefined)).toBe(60)
  })
  it('clamps below the 30s policy floor', () => {
    expect(clampIntervalSec(5)).toBe(REFRESH_HARD_FLOOR_SEC)
    expect(clampIntervalSec(30)).toBe(30)
    expect(clampIntervalSec(90)).toBe(90)
  })
})

describe('resolveRefresh', () => {
  it('returns null when refresh is off', () => {
    expect(resolveRefresh(false)).toBeNull()
    expect(resolveRefresh(undefined)).toBeNull()
  })
  it('resolves boolean true to defaults', () => {
    expect(resolveRefresh(true)).toEqual({ intervalMs: 60_000, minViewablePct: 50, cap: 8 })
  })
  it('honors + clamps overrides', () => {
    expect(resolveRefresh({ intervalSec: 10, minViewablePct: 70, cap: 3 })).toEqual({
      intervalMs: 30_000, // clamped to floor
      minViewablePct: 70,
      cap: 3,
    })
  })
})

describe('shouldRefresh', () => {
  const cfg = { intervalMs: 60_000, minViewablePct: 50, cap: REFRESH_DEFAULT_CAP }

  it('allows when visible, viewable, under cap', () => {
    expect(shouldRefresh({ inViewPct: 60, documentVisible: true, count: 0 }, cfg)).toBe(true)
  })
  it('blocks when tab hidden', () => {
    expect(shouldRefresh({ inViewPct: 100, documentVisible: false, count: 0 }, cfg)).toBe(false)
  })
  it('blocks when below viewable threshold', () => {
    expect(shouldRefresh({ inViewPct: 49, documentVisible: true, count: 0 }, cfg)).toBe(false)
  })
  it('blocks once the cap is reached', () => {
    expect(shouldRefresh({ inViewPct: 100, documentVisible: true, count: 8 }, cfg)).toBe(false)
  })
})
