# frontend

A generic **Astro 6 (SSR)** frontend for the WordPress REST API. **One Cloudflare
Worker serves every site**; the active tenant is resolved per-request from the
request `Host`. Content, branding (favicon/logo/OG) and the sitemap all come from
each tenant's WordPress origin — nothing is baked per build and there is no
service worker.

This Worker is a **[maestro](../etus-maestro) pipeline worker** — `etus-maestro`
routes the tenant hosts and invokes it via the `WP_SITES` service binding (RPC);
it has **no routes of its own**. Its `intercept()` runs the Astro SSR worker and
the rendered page (or static asset / 301) flows through the rest of the maestro
pipeline (ad insertion, analytics). See [Maestro integration](#maestro-integration).

## Rendering + tenant model

- `output: 'server'` + `@astrojs/cloudflare` v13 adapter → one Worker. All routes
  are SSR (no `prerender`). `imageService: 'passthrough'` (no sharp at request time).
- **No tenant is baked.** `astro.config.ts` is generic. At request time
  `src/middleware.ts` calls `resolveTenantByHost(host)` (suffix match on each site's
  `domains`) and sets `Astro.locals.tenant`; components read it from there. Unknown
  host → 404. In `astro dev` the Host is `localhost`, so it falls back to `TENANT_ID`
  or the first site.
- Config for every site lives in `src/lib/sites.config.ts` (`SITES` map). Add a site
  = add an entry there + a `WP_AUTH_<ID>` secret, and have maestro route the new host.
  `getConfig().routes` is derived from `SITES` (one `<host>/*` per tenant domain), so
  the pipeline auto-activates for any host already in the map.

## Layout

| Path | Role |
|---|---|
| `src/lib/sites.config.ts` | `SITES` map + `resolveTenantByHost` / `fallbackTenant` |
| `src/middleware.ts` | resolves tenant from Host → `Astro.locals.tenant`; 404 unknown host |
| `src/pages/index.astro` | SSR homepage feed (WP) |
| `src/pages/[...slug].astro` | SSR post / page / author / category (WP), else 404 |
| `src/lib/wp*.ts` | WordPress REST client, cache, normalize, menus, SEO |
| `src/lib/wp-runtime.ts` | per-request deps; per-tenant `WP_AUTH_<ID>`; WP_CACHE KV |
| `src/components/blog/Wp*.astro` | WP list + post views |
| `public/` | `_headers` / `_redirects` (shared edge config) |

`@etus/ads` (GAM/GPT inline bootstrap) and `@etus/seo` are live workspace packages
(`vite.ssr.noExternal`), vendored in `packages/`.

## Commands

```bash
pnpm dev                                  # astro dev on :4321 (TENANT_ID fallback → limitemais)
pnpm build                                # one generic build → dist/ (server + client)
pnpm check                                # astro check
pnpm test                                 # vitest
pnpm deploy                               # build + deploy the pipeline worker (production)
pnpm deploy:dev                           # build + deploy the pipeline worker (development)
node scripts/shoot.mjs http://localhost:8788   # Playwright screenshots (desktop+mobile)
```

Preview the production build in workerd (resolve by Host):

```bash
pnpm build && cp .dev.vars dist/server/.dev.vars
pnpm exec wrangler dev -c dist/server/wrangler.json --port 8788
curl -H "Host: limitemais.com" http://localhost:8788/      # 200
curl -H "Host: unknown.example" http://localhost:8788/     # 404
```

## Content + branding

Everything user-facing is served from WordPress at request time: posts/pages via
the REST API (`src/lib/wp.ts`), branding (favicon/logo/OG) via the BOLT config API
(`src/lib/wp-config.ts`), images linked from the WP/CDN source (never downloaded),
and the sitemap from the WP origin (`<link rel=sitemap>` → `${wpBaseUrl}/sitemap_index.xml`).

## Maestro integration

This worker plugs into `etus-maestro` as a pipeline worker, the same way
`etus-static-pages` does — `intercept()` produces the page, downstream pipelines
transform it. Differences from a vanilla Astro Cloudflare deploy:

- **No `main` in `wrangler.jsonc`.** The adapter reads this config during
  `astro build` and would bundle `src/index.ts` (which imports the build's own
  `dist/server/entry.mjs`) → circular. The pipeline entry is supplied **positionally**
  at deploy: `wrangler deploy src/index.ts -c wrangler.jsonc --env <env>`.
- **Drop the adapter deploy-redirect.** `astro build` writes
  `.wrangler/deploy/config.json` pointing wrangler at the adapter's own config; the
  deploy scripts `rm -f` it first so our config + entry win.
- **WP-loop bypass.** Server-side WP REST fetches carry `X-Etus-Maestro: bypass`
  (`withMaestroBypass` in `src/lib/wp-runtime.ts`) so SSR-time `/wp-json` calls hit
  the WP origin directly instead of re-entering maestro — `blog.wpBaseUrl` can be the
  public host.
- **Caching.** SSR pages advertise `Cache-Control: public, max-age=300`
  (`src/lib/page-cache.ts`); maestro caches the composited (SSR + ads) page, keyed per
  device via the pipeline's `getCacheKey`. There is no in-worker edge cache.

### Wiring into maestro (`etus-maestro` — applied by maestro maintainers)

1. Service binding under each env in `wrangler.jsonc`:
   ```jsonc
   { "binding": "WP_SITES", "service": "etus-wp-sites-astro-front" }              // production
   { "binding": "WP_SITES", "service": "etus-wp-sites-astro-front-development" }  // development
   ```
2. `PIPELINE_BINDINGS` in `src/main.ts`: `["STATIC_PAGES", "WP_SITES", "MONETIZATION"]`
   — after `STATIC_PAGES` (published static landing pages still win for their exact
   path), before `MONETIZATION` (ads transform the SSR output).
3. Maestro `routes` must cover the tenant hosts (e.g. `cardfacil.com/*`, `*limitemais.com/*`).

**Deploy order:** deploy this worker **before** deploying maestro with the `WP_SITES`
binding (maestro won't deploy a binding to a worker that doesn't exist yet).

### Verifying end-to-end (once maestro is wired)

Run both workers with service bindings (this worker `wrangler dev --env development`,
maestro `pnpm dev`), then through maestro's port:

```bash
curl -H 'Host: cardfacil.com' http://127.0.0.1:8787/ -D -      # 200, text/html, cache-control: public, SSR feed
curl -H 'Host: cardfacil.com' http://127.0.0.1:8787/_astro/... # static asset resolves via ASSETS
```

Confirm: a published static landing page still serves from `STATIC_PAGES` (wins over
SSR for its exact path); ads are injected by `MONETIZATION`; and the worker's
`/wp-json` subrequests carry `X-Etus-Maestro: bypass` and don't recurse.

## Deploy

```bash
pnpm deploy        # astro build → rm redirect → wrangler deploy src/index.ts -c wrangler.jsonc --env production
pnpm deploy:dev    # … --env development
```

Per-env service names (`etus-wp-sites-astro-front` / `-development`) live in
`wrangler.jsonc` `env`. Shared `SESSION` + `WP_CACHE` KV are repeated under each env
(named envs don't inherit top-level `kv_namespaces`); replace the placeholder KV ids
with real ones, and set a `WP_AUTH_<ID>` secret per site per env
(`wrangler secret put WP_AUTH_<ID> --env <env>`) before deploying.
