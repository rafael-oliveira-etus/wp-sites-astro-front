import { defineMiddleware } from 'astro:middleware';
import { resolveDeviceClass } from '@etus/ads';
import {
  CACHE_TTL_SEC,
  cacheKeyUrl,
  cacheTags,
  type EdgeCache,
  isRequestCacheable,
  parseCfDeviceType,
  serveWithCache,
} from './lib/cache';
import { resolveAdsMode } from './lib/runtime';
import { CSP_HEADER, cspForNonce } from './lib/security';

/** Read the Cloudflare runtime env (newer API) defensively — null in non-Worker
 *  contexts (astro check / node dev) so it degrades instead of throwing. */
async function getRuntimeEnv(): Promise<Record<string, unknown> | null> {
  try {
    const m = await import('cloudflare:workers');
    return m.env as unknown as Record<string, unknown>;
  } catch {
    return null;
  }
}

export const onRequest = defineMiddleware(async (context, next) => {
  // Hybrid app: prerendered quiz/hub/404/sw routes are served as static assets and
  // carry their own CSP via each tenant's public/_headers. Skip them entirely — this
  // also prevents the middleware from running (and throwing on env reads) at build
  // time, when only prerendered routes are rendered.
  if (context.isPrerendered) return next();

  const req = context.request;
  const env = await getRuntimeEnv();

  // Environment + ad mode — safe-by-default: noindex unless 'production'; ad mode
  // defaults prod→live, non-prod→'test' (sample network, no billing), forceable to
  // 'off' via ADS_MODE. Tenant identity is BAKED at build (no Host/site resolution).
  const environment = (env?.ENVIRONMENT as string | undefined) ?? 'development';
  const isProduction = environment === 'production';
  const adsMode = resolveAdsMode(env?.ADS_MODE as string | undefined, isProduction);

  const cf = (req as unknown as { cf?: { country?: string } }).cf;
  const cfDeviceHeader = req.headers.get('cf-device-type');

  // Per-request CSP nonce (Web Crypto — present on Workers + the node dev server).
  // Baked into the CSP header AND every inline <script> so the GPT bootstrap runs
  // under strict-dynamic CSP.
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));

  context.locals.deviceClass = resolveDeviceClass({
    cfHeader: cfDeviceHeader,
    ua: req.headers.get('user-agent'),
  });
  context.locals.country = cf?.country ?? null;
  context.locals.environment = environment;
  context.locals.isProduction = isProduction;
  context.locals.adsMode = adsMode;
  context.locals.nonce = nonce;

  // Security headers are applied to the RENDERED response INSIDE the render closure,
  // so the nonce in the CSP header always matches the nonce baked into the (cached)
  // body. We NEVER overwrite CSP post-cache — a hit can't serve a fresh-nonce header
  // over a stale-nonce body (which would make strict CSP block the bootstrap). CSP
  // ships Report-Only first (see lib/security): it observes, never blocks.
  const applySecurity = (r: Response): Response => {
    r.headers.set(CSP_HEADER, cspForNonce(nonce));
    if (!isProduction) r.headers.set('X-Robots-Tag', 'noindex, nofollow');
    return r;
  };

  // Device-keyed edge cache (the spike lever). Only runs behind the real CF edge
  // (CF-Device-Type present) in production, and only when a Worker execution ctx
  // exposes waitUntil — so dev/preview and non-prod fall straight through to a normal
  // render. Fail-open: the cache is a pure optimization, never a 500.
  const cfDevice = parseCfDeviceType(cfDeviceHeader);
  // Worker execution context for waitUntil. In Astro v6 this is Astro.locals.cfContext
  // (locals.runtime.ctx was REMOVED and its getter throws). Access defensively and
  // fail-open to a normal render if it's absent.
  let waitUntil: ((p: Promise<unknown>) => void) | undefined;
  try {
    const cfCtx = (context.locals as unknown as { cfContext?: { waitUntil?: (p: Promise<unknown>) => void } }).cfContext;
    waitUntil = cfCtx?.waitUntil ? cfCtx.waitUntil.bind(cfCtx) : undefined;
  } catch {
    waitUntil = undefined;
  }

  if (waitUntil && cfDevice && isRequestCacheable({ method: req.method, isProduction, device: cfDevice })) {
    const host = req.headers.get('host') ?? new URL(req.url).host;
    return serveWithCache({
      // `caches.default` is the Cloudflare runtime cache; the ambient lib type omits
      // `.default`, so assert the shape (it exists at runtime on Workers).
      cache: (caches as unknown as { default: EdgeCache }).default,
      key: new Request(cacheKeyUrl(req.url, cfDevice)),
      ttlSec: CACHE_TTL_SEC,
      now: Date.now(),
      tags: cacheTags(host, new URL(req.url).pathname),
      waitUntil,
      render: async () => applySecurity(await next()),
    });
  }
  return applySecurity(await next());
});
