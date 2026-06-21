import { defineMiddleware } from 'astro:middleware';
import { resolveDeviceClass } from '@etus/ads';
import { withPublicCache } from './lib/page-cache';
import { resolveAdsMode } from './lib/runtime';
import { CSP_HEADER, cspForNonce } from './lib/security';
import { resolveTenantByHost, fallbackTenant } from './lib/sites.config';

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

  // Tenant identity is resolved per-request from the Host (generic multi-tenant
  // worker — one build serves every site). Unknown host → 404.
  const hostHeader = req.headers.get('host');
  let tenant = resolveTenantByHost(hostHeader);
  if (!tenant) {
    // Local dev/preview is served over `localhost` (matches no site): fall back to
    // TENANT_ID (if set) or the first site so `astro dev` + `wrangler dev` work.
    // A real, unconfigured host is NOT localhost → it correctly 404s.
    const bareHost = (hostHeader ?? '').toLowerCase().split(':')[0];
    if (bareHost === 'localhost' || bareHost === '127.0.0.1' || bareHost === '[::1]') {
      const devId = typeof process !== 'undefined' ? process.env?.TENANT_ID : undefined;
      tenant = fallbackTenant(devId);
    }
  }
  if (!tenant) {
    return new Response('Not Found', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
  context.locals.tenant = tenant;

  const env = await getRuntimeEnv();

  // Environment + ad mode. ad mode defaults prod→live, non-prod→'test' (sample
  // network, no billing), forceable to 'off' via ADS_MODE. Tenant identity is
  // resolved above from the request Host.
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
    return r;
  };

  // No in-worker edge cache here. This worker runs as a maestro pipeline worker;
  // maestro owns the full-page cache (composited with ads, keyed per device via
  // the pipeline's getCacheKey). SSR pages opt into it by advertising a public
  // Cache-Control — see lib/page-cache. Per-request identity is injected
  // downstream in the maestro pipeline (hydrate), never baked into the cached body.
  return withPublicCache(applySecurity(await next()));
});
