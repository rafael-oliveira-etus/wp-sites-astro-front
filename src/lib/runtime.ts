/**
 * Pure runtime-resolution helper(s), kept out of middleware so the ad-mode
 * decision is unit-testable WITHOUT the Worker runtime (no astro:middleware /
 * cloudflare:workers imports here).
 *
 * Adapted from etus-blog: front-quiz bakes the tenant at build (TENANT_ID /
 * TENANT_JSON via vite.define, one Worker per tenant), so there is NO Host→
 * SiteConfig / SITES-KV resolution here — only the ad-mode decision.
 */
import type { AdsMode } from '@etus/ads';

/**
 * Resolve the effective ad mode. Explicit 'live' | 'test' | 'off' always wins;
 * anything else (unset/invalid) defaults by environment: prod→live, else→test
 * (the /6355419/ sample network — validate positions/targeting with no billing).
 */
export function resolveAdsMode(rawMode: string | undefined, isProduction: boolean): AdsMode {
  if (rawMode === 'live' || rawMode === 'test' || rawMode === 'off') return rawMode;
  return isProduction ? 'live' : 'test';
}
