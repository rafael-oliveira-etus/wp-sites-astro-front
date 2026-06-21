// Pure helpers for the maestro pipeline entry (src/index.ts). Kept in their own
// module — free of any `cloudflare:workers` / SSR-bundle import — so they stay
// unit-testable under vitest (importing index.ts directly pulls the vendored SDK
// and the built SSR worker, neither resolvable in the test runtime).

/**
 * The serving routes this pipeline activates on — declared explicitly (the
 * static-pages way), mirroring this project's wrangler.jsonc routes. Maestro
 * uses these in getConfig() to decide which requests reach this worker, and
 * maestro's own wrangler routes must cover the same hosts.
 *
 * IMPORTANT: NOT derived from SITES.domains. cardfacil is served on the
 * `astro-dev` subdomain, NOT the apex `cardfacil.com` — the apex is its
 * WordPress origin; routing it here would loop SSR back into the origin.
 * Add a serving host here when a tenant goes live (apex/www for tenants whose
 * front and WP are separated; a dedicated subdomain otherwise).
 */
export const SERVE_ROUTES: string[] = [
  'limitemais.com/*',
  'www.limitemais.com/*',
  'astro-dev.cardfacil.com/*',
];

/** Composite cache-key dimension: worker version + device, so mobile/desktop SSR
 *  variants cache separately in maestro's full-page cache. Defaults to desktop. */
export function deviceCacheKey(version: string, deviceHeader: string | undefined): string {
  return `${version}:${deviceHeader ?? 'desktop'}`;
}
