# Minimal tenant bootstrap — design

**Date:** 2026-06-20
**Status:** approved (pending spec review)

## Problem

Adding a site today requires a large hand-authored tenant object in
`src/lib/sites.config.ts` (`brand`, `seo`, `display`, `legal`, …). Most of that
duplicates data the app **already pulls from WordPress at runtime** (site name,
colors, logo, favicon, tracking IDs via `/wp-json/bolt/v1/config`; menus,
footer, content via `/wp/v2/*`). The goal: a new site should require only the
irreducible *bootstrap* the edge needs **before** it can talk to WP.

A second, related footgun: the per-tenant WP auth secret name is **derived
implicitly** (`wpAuthEnvKey(id)` = `WP_AUTH_<id.toUpperCase()>`). A `.dev.vars`
entry written with the wrong casing (`WP_AUTH_cardfacil`) is silently not found,
and reads fall back to unauthenticated (menus/widgets/config break with no
error). The config should **declare the exact env var name** instead.

## What is irreducible (must stay local)

When a request hits `cardfacil.com`, the Worker must know — before any WP
call — (a) that the host is a valid tenant, (b) which WP origin to call, and
(c) which secret authenticates the WP edit-context endpoints. Everything else
can come from WP at runtime.

## Design

### Minimal tenant entry (bootstrap only)

```ts
"cardfacil": {
  id: "cardfacil",
  domains: ["cardfacil.com"],
  defaultLocale: "pt-br",
  locales: ["pt-br"],
  wpAuthEnv: "WP_AUTH_CARDFACIL",        // exact env var name; no implicit casing
  blog: { wpBaseUrl: "https://cardfacil.com" },
}
```

`domains: ["cardfacil.com"]` already covers `www.` and `astro-dev.` by the
existing suffix match in `matchHost`.

### Schema changes (`src/lib/schemas.ts`)

- `brand`, `seo`, `display`, `legal` → **optional**.
- Add optional top-level `wpAuthEnv: z.string().optional()` (sibling of `id`).

### UI strings → app-level defaults (not tenant config, not WP)

WordPress does **not** serve the UI chrome micro-copy (skip link, pagination
labels, a11y `aria-label`s, 404 copy, consent banner copy). These stop being
per-tenant config and become a single baked-in pt-br default:

- New constant `DEFAULT_DISPLAY` (pt-br) holding the strings currently inlined
  in the `limitemais` `display["pt-br"]` block.
- `localeDisplay(tenant, locale)` returns the tenant's `display[locale]` when
  present, else `DEFAULT_DISPLAY`. `siteName`/`description` are overlaid from
  BOLT/WP at runtime where available (already the case for branding/logo).

### Brand / SEO defaults

When `brand` is absent, components use neutral defaults; real colors/logo
already overlay from BOLT (`Header.astro`: `apiLogo || tenant.brand.logo`).
When `seo` is absent, `organization.name`/`url` derive from the BOLT site name
and the primary domain; `twitterHandle` empty.

### WP auth resolution (`src/lib/wp-runtime.ts`)

- Resolver: `tenant.wpAuthEnv ?? wpAuthEnvKey(tenant.id)` — explicit field wins,
  derivation stays as the default so `limitemais` works unchanged.
- `wpDepsFromRuntime` / `wpMenu` / `boltConfig` / `footerData` callers resolve
  the key from the tenant (Header, BlogLayout) rather than re-deriving from id.

## What still comes from WP at runtime (unchanged)

Content (posts/pages/categories/authors), header/footer menus, footer widgets,
colors, logo, favicon, site name, tracking IDs. Images stay linked from source
(never downloaded).

## Concrete cardfacil wiring (out of the schema change)

1. Add the minimal `cardfacil` entry above to `SITES`.
2. Fix `.dev.vars`: rename `WP_AUTH_cardfacil` → `WP_AUTH_CARDFACIL`
   (now matched literally by `wpAuthEnv`).
3. `wrangler.jsonc` route `astro-dev.cardfacil.com` already present; the Worker
   serves the dev subdomain while WP lives at the apex `cardfacil.com` → no SSR
   fetch loop.
4. Prod (later, all tenants): real KV ids + `wrangler secret put WP_AUTH_CARDFACIL`.

## Adding any future site after this

1 bootstrap entry in `SITES` (+ optional `wpAuthEnv`) + route(s) in
`wrangler.jsonc` + the `WP_AUTH_<ID>` secret. No `display`/`brand`/`seo`/`legal`.

## Testing

- Unit: `localeDisplay` returns `DEFAULT_DISPLAY` for a tenant with no `display`;
  still returns the tenant block when present (limitemais regression).
- Unit: auth-key resolver prefers `wpAuthEnv`, falls back to `wpAuthEnvKey(id)`.
- Schema parse: the minimal `cardfacil` entry validates; limitemais still parses.
- `astro check` (0 errors) + existing vitest suite green.

## Out of scope

- Moving UI strings into WP/BOLT (option C) — rejected; static i18n shouldn't
  cost a runtime fetch.
- Production routes/KV ids for cardfacil apex+www.
- Any image download/optimization pipeline (permanently out — link from source).
