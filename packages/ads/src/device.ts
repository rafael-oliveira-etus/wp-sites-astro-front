/**
 * PURE device-class helpers. No DOM, no env — unit-tested.
 *
 * Resolution order (server): Cloudflare `CF-Device-Type` header (authoritative,
 * and the same signal that keys the CF cache) → UA parse fallback (local dev /
 * when the header is absent) → 'desktop' default.
 *
 * `viewportDeviceClass` is the CLIENT fail-safe (Mode B) — it can only suppress
 * a wrong-class carrier, never materialize a missing slot (see master plan).
 */
import Bowser from 'bowser'
import type { DeviceClass } from './types.ts'

/** Map Cloudflare's `CF-Device-Type` header value to a DeviceClass. */
export function cfDeviceTypeToClass(header: string | null | undefined): DeviceClass | null {
  if (header === 'mobile' || header === 'tablet' || header === 'desktop') return header
  return null
}

/** UA → DeviceClass via **bowser** (maintained, MIT) — replaces a hand-rolled
 *  regex. Used ONLY as the fallback when the CF-Device-Type header is absent
 *  (local dev / non-CF edges). Note: iPadOS 13+ reports a desktop Safari UA, so
 *  NO UA parser can see it as a tablet — the CF header is authoritative in
 *  production and takes precedence in `resolveDeviceClass`. `platform.type` is
 *  'mobile' | 'tablet' | 'desktop' | 'tv'; anything not mobile/tablet (incl. tv /
 *  unknown) maps to desktop. */
export function uaToDeviceClass(ua: string): DeviceClass {
  try {
    const type = Bowser.parse(ua).platform.type
    return type === 'mobile' ? 'mobile' : type === 'tablet' ? 'tablet' : 'desktop'
  } catch {
    return 'desktop'
  }
}

/** Resolve the active device class from available signals. */
export function resolveDeviceClass(opts: { cfHeader?: string | null; ua?: string | null }): DeviceClass {
  return cfDeviceTypeToClass(opts.cfHeader) ?? (opts.ua ? uaToDeviceClass(opts.ua) : 'desktop')
}

/** Is a slot/placement allowed on the active class? Undefined/empty = all devices. */
export function slotAllowed(devices: DeviceClass[] | undefined, active: DeviceClass): boolean {
  return !devices || devices.length === 0 || devices.includes(active)
}

/** Client viewport breakpoints — MUST mirror the GAM "Viewport Settings used for
 *  client-side device detection": Phone min 0, Tablet min 768, Desktop min 980.
 *  So: mobile ≤767, tablet 768–979, desktop ≥980. Keep CSS @media + GPT size-map
 *  breakpoints on these exact values so a reserved slot matches what GPT serves. */
export const DEVICE_BREAKPOINTS = { mobileMax: 767, tabletMax: 979 } as const

/** Client-side device class from a viewport width (px). Pure — caller passes
 *  window.innerWidth. Used only as the Mode-B suppressor. */
export function viewportDeviceClass(width: number): DeviceClass {
  if (width <= DEVICE_BREAKPOINTS.mobileMax) return 'mobile'
  if (width <= DEVICE_BREAKPOINTS.tabletMax) return 'tablet'
  return 'desktop'
}
