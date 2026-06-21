// Pure helpers for the maestro pipeline entry (src/index.ts). Kept in their own
// module — free of any `cloudflare:workers` / SSR-bundle import — so they stay
// unit-testable under vitest (importing index.ts directly pulls the vendored SDK
// and the built SSR worker, neither resolvable in the test runtime).

/** One `<host>/*` maestro route per tenant domain, deduped. Maestro uses these
 *  in getConfig() to decide which requests activate this pipeline. */
export function buildRoutes(sites: Record<string, { domains: string[] }>): string[] {
  return [...new Set(Object.values(sites).flatMap((s) => s.domains.map((d) => `${d}/*`)))];
}

/** Composite cache-key dimension: worker version + device, so mobile/desktop SSR
 *  variants cache separately in maestro's full-page cache. Defaults to desktop. */
export function deviceCacheKey(version: string, deviceHeader: string | undefined): string {
  return `${version}:${deviceHeader ?? 'desktop'}`;
}
