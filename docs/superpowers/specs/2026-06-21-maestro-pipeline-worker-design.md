# Design — `etus-wp-sites-astro-front` as a Maestro pipeline worker

**Date:** 2026-06-21
**Status:** Approved for planning
**Scope:** both repos — this repo (`etus-wp-sites-astro-front`) **and** `/Workspace/etus-maestro`.

## Goal

Serve this Astro SSR frontend through **etus-maestro** exactly the way
[`etus-static-pages`](https://github.com/etusdigital/etus-static-pages) is served:
as a single **pipeline worker** invoked only via RPC (service binding), with **no
routes of its own**, whose `intercept()` produces the page and lets the rest of the
maestro pipeline (ad insertion via `MONETIZATION`, analytics, …) transform it.

The only substantive difference from `etus-static-pages` is the page source:
static-pages returns **pre-bundled HTML** from an in-memory registry; this worker
runs **Astro SSR** (live WordPress REST) inside `intercept()`. The maestro
integration shape is identical — *nothing more, nothing less*.

This **replaces** the current standalone deployment model. The worker becomes
maestro-only: no `routes`, no `workers_dev`.

## Decisions (locked)

| # | Decision | Choice |
|---|----------|--------|
| 1 | How HTML is produced in the worker | **SSR** dynamically inside `intercept()` (not pre-bundled). |
| 2 | Scope | Both repos. This repo → pipeline worker; maestro → wiring. |
| 3 | Standalone capability | **Retired.** 100% maestro. |
| 4 | Worker topology | **One worker**, mirroring `etus-static-pages` structure exactly. |
| 5 | Caching | **Like static-pages**: `intercept()` returns `Cache-Control: public`, maestro caches the composited (SSR + ads) page with a composite key that includes device; the middleware's internal device edge-cache is **retired**. |

## Architecture

```
client request ──► etus-maestro (the only worker with routes)
                       │  loads pipeline config via RPC, route-matches
                       ├─ STATIC_PAGES.intercept()  → bundled landing page?  yes ─┐
                       │                              no → null                    │
                       ├─ WP_SITES.intercept()      → Astro SSR / asset / 301  ────┤  (first non-null wins)
                       │                                                           │
                       ▼                                                           ▼
                  MONETIZATION.transform() injects ads ◄──────────────────────────┘
                       │  maestro full-page cache (composite key incl. device)
                       ▼
                  response to client
```

- **STATIC_PAGES stays first.** For a path that has a published static landing
  page, static-pages wins (its `intercept` returns non-null and maestro breaks the
  loop). For every other path, `WP_SITES` (this worker) serves SSR. Both flow
  through `MONETIZATION`.
- This worker's `intercept()` serves **everything** for its hosts: SSR HTML,
  prerendered routes, static assets (`/_astro/*`, favicon, etc.), and trailing-slash
  301s — because the Astro adapter's `handle()` already does
  static-asset-match → prerender → SSR in a single call.

## This repo — changes

### Vendored Maestro SDK
Copy the SDK into `src/maestro-sdk/` (`index.ts`, `pipeline.ts`, `types.ts`), exactly
as `etus-static-pages` vendors it. The worker imports `Pipeline`, `PipelineSession`
and the types from there. (Mirror of static-pages; keep in sync manually, like they do.)

### New worker entry — `src/index.ts`
The new `main`. Structure mirrors `etus-static-pages/src/index.ts`:

```ts
import { Pipeline, PipelineSession } from "./maestro-sdk";
import type { PipelineEntry, PipelineRequest, CacheKey } from "./maestro-sdk";
import astro from "../dist/server/entry.mjs"; // adapter SSR worker: default = { fetch }
import { SITES } from "./lib/sites.config";

// Routes the pipeline activates on: every tenant host, all paths.
const ROUTES = [...new Set(
  Object.values(SITES).flatMap((s) => s.domains.map((d) => `${d}/*`))
)];

interface Env { ENVIRONMENT?: string; ASSETS: Fetcher; SESSION: KVNamespace; WP_CACHE: KVNamespace; /* + WP_AUTH_* */ }
type Config = Record<string, never>;

class WpSitesSession extends PipelineSession<Config, Env> {
  // Device dimension so mobile/desktop SSR variants cache separately (decision #5).
  getCacheKey(req: PipelineRequest): CacheKey {
    const device = req.headers["cf-device-type"] ?? "desktop";
    return { key: `${WORKER_VERSION}:${device}`, forbidCaching: false };
  }

  async intercept(req: PipelineRequest): Promise<Response | null> {
    const request = new Request(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body,
    });
    // env via this.env; ctx via this.ctx (waitUntil flows into Astro's app.render).
    return astro.fetch(request, this.env, this.ctx);
  }
}

export default class WpSitesPipeline extends Pipeline<Config, Env> {
  getConfig(): PipelineEntry<Config> {
    return {
      name: "wp-sites",
      enabled: ROUTES.length > 0,
      htmlOnly: false,   // serves assets + redirects too
      successOnly: false,
      routes: ROUTES,
      timeouts: { intercept: 10000 }, // SSR + WP fetch headroom
      config: {},
    };
  }
  createSession() { return new WpSitesSession(this.env, this.ctx); }
}
```

Notes:
- `astro.fetch(request, env, ctx)` — `dist/server/entry.mjs` `export default`s the
  adapter worker (`{ fetch: handle }`), virtual modules already resolved into chunks
  at `astro build`; only `cloudflare:workers` remains as a workerd builtin. `handle`
  reads bindings from the passed `env` and from the `cloudflare:workers` global env,
  both of which resolve to **this worker's** bindings when maestro invokes us via RPC.
- `getConfig().enabled` follows `ROUTES.length > 0` (a tenant always exists, so
  effectively always enabled) — mirrors static-pages' shape.

### Build flow (two steps — `astro build` is our "publish")
1. `astro build` → `dist/server/` (importable SSR) + `dist/client/` (assets).
2. `wrangler deploy` with `main: src/index.ts` bundles our entry + SDK + the built
   SSR. This is the analogue of static-pages committing `pages.generated.ts` then
   deploying.

`package.json` scripts gain a `deploy`/`deploy:dev` that run `astro build` then
`wrangler deploy --env <env>` (mirror static-pages' `deploy` scripts).

### WordPress loop bypass (the trap)
SSR fetches WordPress at runtime. If `wpBaseUrl` is a maestro-routed host, the
`/wp-json` subrequest re-enters maestro. Fix at the **single** server-side fetch
choke-point (`deps.fetch` built in `src/lib/wp-runtime.ts`, used by `wp.ts`,
`wp-config.ts`, `wp-footer.ts`, `wp-menu.ts`): inject header
`X-Etus-Maestro: bypass`. Maestro already honors it (`src/main.ts:65`) and passes the
request straight to origin. `wpBaseUrl` values stay unchanged. (Client-side
analytics/events fetches target non-maestro hosts → untouched.)

### Caching (decision #5)
- `intercept()`'s SSR response must carry `Cache-Control: public, max-age=N` so maestro
  opts it into the full-page cache (composited with ads). Where the Astro response
  currently lacks it, set it (per-route TTL TBD during planning; start ~300s like
  static-pages).
- Fold **device** into `getCacheKey()` (above) so mobile/desktop don't leak.
- **Retire** the middleware's internal device edge-cache (`serveWithCache` /
  `caches.default` block in `src/middleware.ts`). Tenant resolution, ad mode, CSP
  nonce, device class all **stay** — only the `serveWithCache` branch is removed.

### `wrangler.jsonc` — changes
- `main: "src/index.ts"` (was `@astrojs/cloudflare/entrypoints/server`).
- **Remove** `routes` and `workers_dev`.
- Keep `assets` (`ASSETS` → `./dist/client`), `SESSION` + `WP_CACHE` KV, `nodejs_compat`,
  `compatibility_date`, `vars.ENVIRONMENT`, `observability`.
- Add `env.development` / `env.production` blocks with the service `name`
  (`etus-wp-sites-astro-front` / `-development`) — mirror static-pages.
- `WP_AUTH_*` remain secrets (`wrangler secret put`).

## Maestro repo — changes (`/Workspace/etus-maestro`)

1. **Service binding** under both envs in `wrangler.jsonc`:
   ```jsonc
   { "binding": "WP_SITES", "service": "etus-wp-sites-astro-front" }              // production
   { "binding": "WP_SITES", "service": "etus-wp-sites-astro-front-development" }  // development
   ```
2. **`PIPELINE_BINDINGS`** in `src/main.ts` → `["STATIC_PAGES", "WP_SITES", "MONETIZATION"]`
   (WP_SITES after STATIC_PAGES, before MONETIZATION).
3. **Routes** must cover the tenant hosts. `*limitemais.com/*` already present; add
   `cardfacil.com/*` (+ `www.cardfacil.com/*`) so the full site — not just the s1
   landing prefixes — routes through maestro. Confirm desired host set during planning.

## Deploy order
Deploy `etus-wp-sites-astro-front` **before** deploying maestro with the new
`WP_SITES` binding (maestro won't deploy a binding to a non-existent worker) — same
constraint static-pages documents.

## Local dev / preview
Service-bound workers need both running. Plan to use `wrangler dev` multi-worker
(maestro + this worker via `--env development` service bindings), or maestro's dev
with this worker registered. The current pure-`pnpm dev` Host-based testing still
works for SSR in isolation (no maestro), but end-to-end testing now goes through
maestro dev. Exact local recipe to be nailed in the plan.

## Risks / things to verify during implementation
- **Build wiring spike (primary risk):** confirm `wrangler deploy` with `main:
  src/index.ts` cleanly bundles `dist/server/entry.mjs` + chunks (ESM, `nodejs_compat`,
  `cloudflare:workers` left external). Confirm the adapter still emits an importable
  `dist/server/entry.mjs` under our wrangler config (we ignore the adapter-emitted
  `dist/server/wrangler.json`).
- **Set-Cookie & full-page cache:** verify SSR responses carry no per-user
  `Set-Cookie` (e.g. Astro session) before letting maestro cache the page; per-request
  identity must live in `hydrate()` (downstream), never in the cached body — mirror
  static-pages.
- **CSP nonce under caching:** the per-request CSP nonce is baked into the cached body.
  CSP currently ships **Report-Only** (never blocks), so a cached-nonce mismatch is
  observed, not fatal — confirm this stays Report-Only, or move nonce handling out of
  the cached path.
- **Asset requests through maestro:** confirm `/_astro/*` and other static assets
  served by `intercept()` (via `env.ASSETS`) behave with `htmlOnly:false`
  (MONETIZATION has `htmlOnly:true` so it skips them).
- **`ctx`/`waitUntil`:** confirm the `ctx` handed to `createSession`/`intercept`
  exposes `waitUntil` so the WP SWR cache (`WP_CACHE`) revalidation isn't cancelled.

## Out of scope
- Pre-rendering the whole site to static HTML (rejected — decision #1).
- A second/forwarding worker or extra RPC hop (rejected — decision #4).
- Changing the WordPress origin topology / `wpBaseUrl` values.
