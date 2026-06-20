/**
 * PURE refresh decision logic — no DOM, no timers. Unit-tested.
 * The DOM/event wiring lives in src/client/refresh.ts and calls these.
 *
 * Pass-3 verified (GAM Help 6286179 / 6022114): hard 30s floor, 60s
 * recommended interval; refresh only while viewable; declare in GAM.
 */
import type { RefreshConfig } from './types.ts'

export const REFRESH_HARD_FLOOR_SEC = 30
export const REFRESH_DEFAULT_INTERVAL_SEC = 60
export const REFRESH_DEFAULT_VIEWABLE_PCT = 50
export const REFRESH_DEFAULT_CAP = 8

export type ResolvedRefresh = {
  intervalMs: number
  minViewablePct: number
  cap: number
}

/** Clamp to the 30s policy floor; default 60s. */
export function clampIntervalSec(sec?: number): number {
  const v = sec ?? REFRESH_DEFAULT_INTERVAL_SEC
  return v < REFRESH_HARD_FLOOR_SEC ? REFRESH_HARD_FLOOR_SEC : v
}

export function resolveRefresh(cfg: RefreshConfig | boolean | undefined): ResolvedRefresh | null {
  if (!cfg) return null
  const c = typeof cfg === 'object' ? cfg : {}
  return {
    intervalMs: clampIntervalSec(c.intervalSec) * 1000,
    minViewablePct: c.minViewablePct ?? REFRESH_DEFAULT_VIEWABLE_PCT,
    cap: c.cap ?? REFRESH_DEFAULT_CAP,
  }
}

export type RefreshState = {
  inViewPct: number
  documentVisible: boolean
  count: number
}

/** Decide, at fire time, whether a refresh is allowed. */
export function shouldRefresh(state: RefreshState, cfg: ResolvedRefresh): boolean {
  return (
    state.documentVisible &&
    state.inViewPct >= cfg.minViewablePct &&
    state.count < cfg.cap
  )
}
