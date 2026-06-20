/**
 * Pure config helpers. No DOM, no side effects — unit-tested.
 */
import type { AdsMode, AdsSiteConfig, CollapseDiv, PpsConfig, SecureSignalProvider, TagForAgeTreatment } from './types.ts'

export type ResolvedAdsConfig = {
  networkCode: string
  mcmManagerPubId?: string
  mcmManagerDomain?: string
  singleRequest: boolean
  lazyLoad: { fetchMarginPercent: number; renderMarginPercent: number; mobileScaling: number }
  collapseDiv?: CollapseDiv
  enablePpid: boolean
  secureSignalProviders: SecureSignalProvider[]
  pps?: PpsConfig
  forceNpa: boolean
  tagForAgeTreatment?: TagForAgeTreatment
}

export function withDefaults(cfg: AdsSiteConfig): ResolvedAdsConfig {
  const resolved: ResolvedAdsConfig = {
    networkCode: cfg.networkCode,
    singleRequest: cfg.singleRequest ?? true,
    lazyLoad: {
      // GPT publishes NO fixed lazyLoad defaults ("a default set by Google, tuned
      // over time"). These mirror Google's own sample example — fetch within 5
      // viewports, render within 2, 2x margins on mobile. Set a tenant value to
      // null to disable that margin.
      fetchMarginPercent: cfg.lazyLoad?.fetchMarginPercent ?? 500,
      renderMarginPercent: cfg.lazyLoad?.renderMarginPercent ?? 200,
      mobileScaling: cfg.lazyLoad?.mobileScaling ?? 2.0,
    },
    enablePpid: cfg.enablePpid ?? true,
    secureSignalProviders: cfg.secureSignalProviders ?? [],
    forceNpa: cfg.forceNpa ?? false,
  }
  // Only attach optional fields when present (cleaner JSON blob, fewer no-ops).
  if (cfg.mcmManagerPubId) resolved.mcmManagerPubId = cfg.mcmManagerPubId
  if (cfg.mcmManagerDomain) resolved.mcmManagerDomain = cfg.mcmManagerDomain
  if (cfg.collapseDiv) resolved.collapseDiv = cfg.collapseDiv
  if (cfg.pps) resolved.pps = cfg.pps
  if (cfg.tagForAgeTreatment) resolved.tagForAgeTreatment = cfg.tagForAgeTreatment
  return resolved
}

/** Compose the full ad-unit path: /{network}/{slug} */
export function fullAdUnit(networkCode: string, adUnit: string): string {
  const clean = adUnit.replace(/^\/+|\/+$/g, '')
  return `/${networkCode}/${clean}`
}

/** Google's documented sample/test network — always fills with test creatives
 *  (developers.google.com/publisher-tag/samples/display-test-ad). */
export const TEST_NETWORK_CODE = '6355419'

/** The network code to actually use, given the ad mode. In 'test' mode the
 *  slot's full path becomes /{testNetwork}/{adUnit} → test creatives, while the
 *  rest of the slot (sizes, targeting, device gating, refresh) is unchanged. */
export function effectiveNetworkCode(
  cfg: { networkCode: string; testNetworkCode?: string },
  mode: AdsMode,
): string {
  return mode === 'test' ? (cfg.testNetworkCode ?? TEST_NETWORK_CODE) : cfg.networkCode
}

/** Sort breakpoints DESC so GPT's sizeMapping picks the largest-matching range. */
export function sortedBreakpoints(map: Record<number, unknown>): number[] {
  return Object.keys(map)
    .map(Number)
    .sort((a, b) => b - a)
}

/** Origins to preconnect to — shaves DNS/TLS off the first ad request. */
export const AD_PRECONNECT_ORIGINS: ReadonlyArray<string> = [
  'https://securepubads.g.doubleclick.net',
  'https://pagead2.googlesyndication.com',
  'https://googleads.g.doubleclick.net',
  'https://tpc.googlesyndication.com',
  'https://fundingchoicesmessages.google.com',
]

/** Canonical GPT library URL (async, HTTPS, modern host). */
export const GPT_SRC = 'https://securepubads.g.doubleclick.net/tag/js/gpt.js'
