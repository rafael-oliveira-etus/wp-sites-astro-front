/**
 * Device-keyed edge-cache policy for the public SSR pages (the spike / viral-
 * traffic lever). PURE + unit-testable; the Worker glue lives in middleware.ts.
 *
 * WHY device-keyed: ads are server-gated per device (a mobile page ships ONLY
 * mobile slots), so a shared cache MUST vary by device or it serves the wrong ad
 * set. We key on the raw `CF-Device-Type` header (the exact signal the ad-gate
 * uses) and ONLY cache when it is present — so the cache key and the rendered
 * variant can never disagree, and dev (no CF header) is never cached. Never
 * `Vary: User-Agent` (it shatters the cache).
 *
 * Scope: read-path + bounded TTL. TTL bounds staleness, so this is correct
 * WITHOUT active purge. Tag-based purge-on-publish is a documented, deferred
 * interface (see `cacheTags`) — do not wire it until the Cache-API-entry-is-tag-
 * purgeable question is confirmed in CF docs (tracked in TECH_DEBT).
 *
 * Ported from etus-blog/apps/web/src/lib/cache.ts (verbatim — pure logic).
 */

export type CfDeviceType = 'mobile' | 'tablet' | 'desktop';

/** Default edge freshness window (seconds). Bounds staleness in the absence of
 *  active purge; long enough to absorb an email-blast spike, short enough that
 *  an edit propagates on its own. */
export const CACHE_TTL_SEC = 60;

/** Query params that never change rendered content — stripped from the cache key
 *  so an email/social blast (`?utm_source=…`) doesn't fragment the cache. */
export const TRACKING_PARAMS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'gclid',
  'fbclid',
  'gbraid',
  'wbraid',
  'msclkid',
  'mc_cid',
  'mc_eid',
  'ref',
  'ref_src',
];

/** The synthetic-key query param that carries the device dimension. */
export const DEVICE_KEY_PARAM = '__etus_dev';
/** Header stamped on the stored copy to drive the fresh/stale decision. */
export const CACHED_AT_HEADER = 'x-etus-cached-at';
/** Observability header on the user-facing response. */
export const CACHE_STATUS_HEADER = 'x-etus-cache';

/** Parse the Cloudflare `CF-Device-Type` header to a class, or null if absent/invalid. */
export function parseCfDeviceType(header: string | null | undefined): CfDeviceType | null {
  return header === 'mobile' || header === 'tablet' || header === 'desktop' ? header : null;
}

/** Build the device-namespaced cache-key URL: drop tracking params, then add the
 *  device dimension. Deterministic regardless of param order. */
export function cacheKeyUrl(rawUrl: string, device: CfDeviceType): string {
  const url = new URL(rawUrl);
  for (const p of TRACKING_PARAMS) url.searchParams.delete(p);
  url.searchParams.delete(DEVICE_KEY_PARAM);
  url.searchParams.sort();
  url.searchParams.set(DEVICE_KEY_PARAM, device);
  return url.toString();
}

/** Should THIS request use the edge cache? Only production GET requests that
 *  carry a valid CF-Device-Type (i.e. are actually behind the CF edge). */
export function isRequestCacheable(opts: {
  method: string;
  isProduction: boolean;
  device: CfDeviceType | null;
}): boolean {
  return opts.isProduction && opts.method === 'GET' && opts.device !== null;
}

/** Should THIS response be stored? Only 200 HTML with no Set-Cookie (a Set-Cookie
 *  would leak a per-user session id to everyone). */
export function isResponseCacheable(res: Response): boolean {
  if (res.status !== 200) return false;
  if (res.headers.has('set-cookie')) return false;
  return (res.headers.get('content-type') ?? '').includes('text/html');
}

/** Fresh if the stored copy is younger than the TTL. */
export function isFresh(cachedAtMs: number, nowMs: number, ttlSec: number): boolean {
  if (!Number.isFinite(cachedAtMs) || cachedAtMs <= 0) return false;
  return nowMs - cachedAtMs < ttlSec * 1000;
}

/** Cache tags for a (host, path) — the purge surface for the deferred purge-on-
 *  publish hook (purge `path:<path>` to drop EVERY device variant at once). */
export function cacheTags(host: string, path: string): string[] {
  return ['etus-page', `site:${host}`, `path:${path}`];
}

/** Minimal cache surface we depend on (the real `caches.default` is a superset). */
export interface EdgeCache {
  match(key: Request): Promise<Response | undefined>;
  put(key: Request, response: Response): Promise<void>;
}

/** Reconstruct a Response with mutable headers, applying sets/deletes. */
function reheader(res: Response, body: BodyInit | null, set: Record<string, string>, del: string[] = []): Response {
  const out = new Response(body, res);
  for (const k of del) out.headers.delete(k);
  for (const [k, v] of Object.entries(set)) out.headers.set(k, v);
  return out;
}

const USER_CACHE_CONTROL = 'public, max-age=0, must-revalidate';

/**
 * Serve a request through the edge cache. PURE orchestration — inject the cache,
 * clock, waitUntil and render so it is fully unit-testable. FAIL-OPEN: any cache
 * error falls through to a fresh render; the cache is only an optimization.
 */
export async function serveWithCache(opts: {
  cache: EdgeCache;
  key: Request;
  ttlSec: number;
  now: number;
  tags: string[];
  waitUntil: (p: Promise<unknown>) => void;
  render: () => Promise<Response>;
}): Promise<Response> {
  const { cache, key, ttlSec, now, tags, waitUntil, render } = opts;

  // Read (fail-open).
  let cached: Response | undefined;
  try {
    cached = await cache.match(key);
  } catch {
    cached = undefined;
  }
  if (cached) {
    const cachedAt = Number(cached.headers.get(CACHED_AT_HEADER) ?? 0);
    if (isFresh(cachedAt, now, ttlSec)) {
      return reheader(cached, cached.body, { 'cache-control': USER_CACHE_CONTROL, [CACHE_STATUS_HEADER]: 'HIT' });
    }
    // stale → fall through and re-render
  }

  const rendered = await render();
  if (!isResponseCacheable(rendered)) {
    return reheader(rendered, rendered.body, { [CACHE_STATUS_HEADER]: 'BYPASS' });
  }

  // Store a clone with the freshness stamp + tags; return the original to the user.
  const storeCopy = rendered.clone();
  const toStore = reheader(storeCopy, storeCopy.body, {
    'cache-control': `public, max-age=${ttlSec}`,
    'cache-tag': tags.join(','),
    [CACHED_AT_HEADER]: String(now),
  });
  try {
    waitUntil(cache.put(key, toStore).catch(() => {}));
  } catch {
    // no waitUntil / put rejected synchronously → skip caching, still serve
  }
  return reheader(rendered, rendered.body, {
    'cache-control': USER_CACHE_CONTROL,
    [CACHE_STATUS_HEADER]: cached ? 'STALE' : 'MISS',
  });
}
