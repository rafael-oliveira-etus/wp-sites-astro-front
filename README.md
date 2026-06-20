# frontend

A generic **Astro 6 (SSR)** frontend for the WordPress REST API. **One Cloudflare
Worker serves every site**; the active tenant is resolved per-request from the
request `Host`. Content, branding (favicon/logo/OG) and the sitemap all come from
each tenant's WordPress origin — nothing is baked per build and there is no
service worker.

## Rendering + tenant model

- `output: 'server'` + `@astrojs/cloudflare` v13 adapter → one Worker. All routes
  are SSR (no `prerender`). `imageService: 'passthrough'` (no sharp at request time).
- **No tenant is baked.** `astro.config.ts` is generic. At request time
  `src/middleware.ts` calls `resolveTenantByHost(host)` (suffix match on each site's
  `domains`) and sets `Astro.locals.tenant`; components read it from there. Unknown
  host → 404. In `astro dev` the Host is `localhost`, so it falls back to `TENANT_ID`
  or the first site.
- Config for every site lives in `src/lib/sites.config.ts` (`SITES` map). Add a site
  = add an entry there + two `routes` lines in `wrangler.jsonc` + a `WP_AUTH_<ID>`
  secret.

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
pnpm build                                # one generic build → dist/
pnpm check                                # astro check
pnpm test                                 # vitest
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

## Deploy

One Worker (`frontend`) with one `routes` pair (apex + www) per site in
`wrangler.jsonc`, shared `SESSION` + `WP_CACHE` KV, and a `WP_AUTH_<ID>` secret per
site (`wrangler secret put WP_AUTH_<ID>`). Replace the placeholder KV ids with real
ones before `wrangler deploy`.

> Infra note: each tenant's `blog.wpBaseUrl` must point at the real WordPress origin,
> not the public domain the Worker serves, or the SSR fetch loops back on itself.
