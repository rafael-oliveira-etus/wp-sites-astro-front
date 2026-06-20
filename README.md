# frontend

Multi-tenant **Astro 6 hybrid** app — quiz/lead-gen funnel (prerendered) +
ad-monetized blog (SSR) — that deploys as **one Cloudflare Worker per tenant**
(`frontend-<tenant>`).

## Rendering + tenant model

- `output: 'server'` + `@astrojs/cloudflare` v13 adapter → a Worker. Per-route
  `export const prerender = true` makes quiz / vertical hubs / author pages static
  assets; blog post routes render SSR per-request. `imageService: 'passthrough'`
  (no sharp at request time on Workers).
- **One tenant baked per build.** `TENANT_ID=<id>` selects the tenant; `astro.config.ts`
  bakes it via `vite.define` (`import.meta.env.TENANT_ID`/`TENANT_JSON`/`TENANT_LOGO_SVG`/
  `TENANT_CONTENT_DIR`/`IMAGE_MANIFEST`/`PUBLIC_IMAGE_BASE`/`MINIFIED_BOOT`) — the
  workerd prerender sandbox has no `node:fs`/`process.env`, so tenant data must be
  baked, not read at runtime.
- Quiz routes **must** keep `prerender = true` — dropping it silently flips them to
  SSR. (Active invariant; see root `CLAUDE.md`.)

## Layout

| Path | Role |
|---|---|
| `src/pages/[locale]/blog/[vertical]/[slug].astro` | SSR blog post |
| `src/pages/[locale]/blog/[vertical]/[...page].astro` | prerendered paginated vertical hub |
| `src/pages/[locale]/author/[id]/[...page].astro` | prerendered author page (E-E-A-T) |
| `src/lib/{schemas,authors,images,markdown,seo}.ts` | post/tenant schemas, author resolution, image manifest, render, JSON-LD |
| `tenants/<id>/tenant.yaml` | per-tenant config (seo, display, editorial, authors, ads) |
| `tenants/<id>/assets/` | logo + blog images (`blog-images/` is gitignored, R2-bound) |
| `sites.manifest.json` | fleet registry (per-site Worker/routes/KV/ring) — deploy |
| `scripts/` | `gen-wrangler.mjs`, `fleet-healthcheck.mjs`, `post-images.mjs`, `optimize-tenant-assets.mjs` |

`@etus/ads` (GAM/GPT inline bootstrap) and `@etus/seo` are live workspace packages
(`vite.ssr.noExternal`).

## Commands

```bash
TENANT_ID=limitemais pnpm --filter frontend dev       # astro dev (defaults to limitemais)
TENANT_ID=<id>        pnpm --filter frontend build     # one tenant → dist/
                      pnpm --filter frontend check      # astro check
node scripts/post-images.mjs --tenant <id>             # download + AVIF/WebP optimize blog images
```

## Content

Blog content is imported from the WordPress network by `apps/content-import`
(registry-driven, multilingual) into `tenants/<id>/content/`. Images are downloaded
+ optimized by `scripts/post-images.mjs` (R2-ready; set `PUBLIC_IMAGE_BASE` to serve
derivatives from R2).

## Deploy

Per-site isolated fleet — **not** Cloudflare Pages. `sites.manifest.json` →
`scripts/gen-wrangler.mjs` (patches the adapter's built `dist/server/wrangler.json`
with each site's name/routes/SESSION-KV) → `.github/workflows/deploy-fleet.yml`
(validate → canary ring 0 → manual gate → rings). The top-level `wrangler.jsonc` is
for local `dev` / `cf-typegen` only.

Full model + rollback + Workers-for-Platforms scale trigger:
[`docs/blog-platform/fleet-deploy.md`](../../docs/blog-platform/fleet-deploy.md).
Architecture + invariants: root [`CLAUDE.md`](../../CLAUDE.md) and
[`docs/blog-platform/`](../../docs/blog-platform/).
