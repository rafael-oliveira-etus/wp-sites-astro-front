// SSR pages opt into maestro's full-page cache (composited with ads), mirroring
// etus-static-pages. Per-request identity is handled downstream in the maestro
// pipeline (hydrate), never baked into the cached body. Pure (no Astro/runtime
// imports) so it stays unit-testable; middleware.ts applies it to SSR responses.

/** Edge cache lifetime (seconds) advertised to maestro on every SSR page. */
export const PAGE_MAX_AGE = 300;

/** Tag an SSR response as publicly cacheable so maestro stores the composited
 *  (SSR + ads) page. Mutates and returns the same Response. */
export function withPublicCache(r: Response): Response {
  r.headers.set('cache-control', `public, max-age=${PAGE_MAX_AGE}`);
  return r;
}
