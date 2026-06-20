/**
 * PURE serialization helpers used by the ad components — reserved-height (zero
 * CLS) CSS plus the Mode-B device-CSV parser. No DOM access; unit-tested.
 */
import { sortedBreakpoints } from './config.ts'
import type { DeviceClass, ReserveMap } from './types.ts'

/** Parse the `data-devices` CSV back to a device-class list (Mode-B client gate). */
export function parseDevices(csv: string | undefined): DeviceClass[] | undefined {
  if (!csv) return undefined
  const list = csv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean) as DeviceClass[]
  return list.length ? list : undefined
}

/* --------------------------- reserve heights --------------------------- */

/** Inline min-height for the smallest breakpoint (zero CLS baseline). */
export function reserveHeightStyle(reserve: ReserveMap): string {
  const bps = sortedBreakpoints(reserve)
  if (!bps.length) return ''
  const base = reserve[0] ?? Math.min(...Object.values(reserve))
  return `min-height:${base}px;`
}

/** Per-breakpoint min-height media queries (scoped to the slot id). */
export function reserveMediaCss(id: string, reserve: ReserveMap): string {
  return sortedBreakpoints(reserve)
    .filter((b) => b > 0)
    .sort((a, b) => a - b)
    .map((bp) => `@media(min-width:${bp}px){#${cssEscape(id)}{min-height:${reserve[bp]}px}}`)
    .join('')
}

/** Minimal CSS identifier escape for ids we generate (alnum + dash). */
export function cssEscape(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '\\$&')
}
