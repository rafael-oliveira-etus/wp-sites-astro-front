# Maestro Pipeline Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve this Astro SSR frontend through `etus-maestro` as a single pipeline worker (RPC-only, no routes), exactly like `etus-static-pages` — but with `intercept()` running Astro SSR instead of returning bundled HTML.

**Architecture:** One worker. `main: src/index.ts` exports a `Pipeline` (vendored maestro SDK). `intercept()` reconstructs a `Request` and calls the Astro adapter's built SSR worker (`dist/server/entry.mjs` default export). Maestro owns routing/caching/ad-compositing. WP REST subrequests carry `X-Etus-Maestro: bypass` so SSR-time fetches don't loop back through maestro.

**Tech Stack:** Astro 6 (`@astrojs/cloudflare` v13.7, `output: 'server'`), Cloudflare Workers + wrangler v4, vendored `@etus/maestro-sdk` (`WorkerEntrypoint`/`RpcTarget` from `cloudflare:workers`), vitest.

## Global Constraints

- **One worker only.** No second/forwarding worker, no extra RPC hop. Mirror `etus-static-pages` structure: vendored SDK at `src/maestro-sdk/`, `Pipeline` default-exported from `src/index.ts`. (spec decision #4)
- **Maestro-only.** Remove `routes` and `workers_dev` from `wrangler.jsonc`. Standalone deploy retired. (spec decision #3)
- **SSR in `intercept()`**, not pre-bundled HTML. (spec decision #1)
- **Caching like static-pages**: SSR response carries `Cache-Control: public, max-age=300`; device folded into `getCacheKey()`; middleware device edge-cache retired. (spec decision #5)
- **Pipeline order in maestro:** `["STATIC_PAGES", "WP_SITES", "MONETIZATION"]` — WP_SITES after STATIC_PAGES, before MONETIZATION.
- **Bypass header value:** literal `X-Etus-Maestro: bypass` (maestro `src/main.ts:65`).
- Tenant resolution by Host in `src/middleware.ts` stays unchanged.
- Bindings the worker keeps: `ASSETS` → `./dist/client`, `SESSION` KV, `WP_CACHE` KV, `WP_AUTH_*` secrets, `compatibility_flags: ["nodejs_compat"]`.

---

### Task 1: Build spike — prove one-worker SSR bundling (DE-RISK GATE)

This is the primary risk. Prove a single wrangler worker whose `main` is our pipeline entry can bundle the adapter's built SSR before building anything else. If it fails, stop and reassess the architecture with the spec author.

**Files:**
- Create: `src/maestro-sdk/index.ts`, `src/maestro-sdk/pipeline.ts`, `src/maestro-sdk/types.ts` (vendored copies)
- Create: `src/index.ts` (minimal pipeline entry)
- Create: `src/dist-server.d.ts` (ambient type for the built SSR import)
- Modify: `wrangler.jsonc`

**Interfaces:**
- Produces: `dist-server` module default export typed as `{ fetch(request: Request, env: unknown, ctx: ExecutionContext): Promise<Response> }`; `default class extends Pipeline` from `src/index.ts`.

- [ ] **Step 1: Vendor the maestro SDK verbatim from the maestro repo**

```bash
mkdir -p src/maestro-sdk
cp /Users/etus_0181/Workspace/etus-maestro/sdk/index.ts    src/maestro-sdk/index.ts
cp /Users/etus_0181/Workspace/etus-maestro/sdk/pipeline.ts src/maestro-sdk/pipeline.ts
cp /Users/etus_0181/Workspace/etus-maestro/sdk/types.ts    src/maestro-sdk/types.ts
```

- [ ] **Step 2: Add the ambient declaration for the built SSR import**

Create `src/dist-server.d.ts` (mirrors how `etus-static-pages` declares `.html` imports):

```ts
// The Astro Cloudflare adapter emits dist/server/entry.mjs at `astro build`.
// It default-exports the SSR worker ({ fetch }). It only exists after a build,
// so declare it ambiently for typecheck (astro check / tsc don't need the file).
declare module '../dist/server/entry.mjs' {
  const worker: {
    fetch(request: Request, env: unknown, ctx: ExecutionContext): Promise<Response>;
  };
  export default worker;
}
```

- [ ] **Step 3: Write the minimal pipeline entry**

Create `src/index.ts`:

```ts
import { Pipeline, PipelineSession } from './maestro-sdk';
import type { PipelineEntry, PipelineRequest } from './maestro-sdk';
import astro from '../dist/server/entry.mjs';

interface Env {
  ENVIRONMENT?: string;
  ASSETS: Fetcher;
  SESSION: KVNamespace;
  WP_CACHE: KVNamespace;
}

type Config = Record<string, never>;

class WpSitesSession extends PipelineSession<Config, Env> {
  async intercept(req: PipelineRequest): Promise<Response | null> {
    const request = new Request(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body,
    });
    return astro.fetch(request, this.env, this.ctx);
  }
}

export default class WpSitesPipeline extends Pipeline<Config, Env> {
  getConfig(): PipelineEntry<Config> {
    return {
      name: 'wp-sites',
      enabled: true,
      htmlOnly: false,
      successOnly: false,
      routes: ['*'],
      timeouts: { intercept: 10000 },
      config: {},
    };
  }
  createSession(): WpSitesSession {
    return new WpSitesSession(this.env, this.ctx);
  }
}
```

- [ ] **Step 4: Point wrangler at the new entry; strip standalone routing**

Edit `wrangler.jsonc`: set `"main": "src/index.ts"`, delete the `routes` array, delete `"workers_dev": false`. Keep `assets`, `kv_namespaces`, `compatibility_flags`, `vars`, `observability`. Update `assets.directory` to `"./dist/client"` (the adapter splits server/client; `main` is no longer the adapter so point ASSETS at the client dir). Add per-env service names:

```jsonc
"env": {
  "development": { "name": "etus-wp-sites-astro-front-development", "vars": { "ENVIRONMENT": "development" } },
  "production":  { "name": "etus-wp-sites-astro-front",             "vars": { "ENVIRONMENT": "production" } }
}
```

- [ ] **Step 5: Build Astro, then bundle the worker with --dry-run**

Run:
```bash
pnpm build
pnpm exec wrangler deploy --env development --dry-run --outdir /tmp/wp-sites-bundle
```
Expected: `astro build` produces `dist/server/entry.mjs` + `dist/client/`. `wrangler deploy --dry-run` completes with `Total Upload: … KiB` and writes a bundle to `/tmp/wp-sites-bundle` — **no** "could not resolve" / virtual-module errors. This proves the SSR chunks + `cloudflare:workers` (left external under `nodejs_compat`) bundle cleanly behind our `main`.

- [ ] **Step 6: Typecheck**

Run: `pnpm exec astro check`
Expected: 0 errors (the ambient `dist-server.d.ts` satisfies the import without the file being present at check time).

- [ ] **Step 7: Commit**

```bash
git add src/maestro-sdk src/index.ts src/dist-server.d.ts wrangler.jsonc
git commit -m "feat: vendor maestro SDK + minimal pipeline entry; bundle SSR behind it"
```

---

### Task 2: WordPress-loop bypass header

Inject `X-Etus-Maestro: bypass` on every server-side WP REST fetch at the single choke-point (`wpDeps`), so SSR-time `/wp-json` calls pass straight through maestro to origin.

**Files:**
- Modify: `src/lib/wp-runtime.ts` (add `withMaestroBypass`, apply in `wpDeps`)
- Test: `src/lib/wp-runtime.test.ts` (create)

**Interfaces:**
- Produces: `withMaestroBypass(base: typeof fetch): typeof fetch` exported from `src/lib/wp-runtime.ts`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/wp-runtime.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { withMaestroBypass } from './wp-runtime';

describe('withMaestroBypass', () => {
  it('adds X-Etus-Maestro: bypass to every request', async () => {
    const base = vi.fn(async () => new Response('ok'));
    const f = withMaestroBypass(base as unknown as typeof fetch);
    await f('https://cardfacil.com/wp-json/wp/v2/posts', { headers: { accept: 'application/json' } });
    const init = base.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get('X-Etus-Maestro')).toBe('bypass');
    expect(headers.get('accept')).toBe('application/json'); // preserves existing headers
  });

  it('works when no init/headers are passed', async () => {
    const base = vi.fn(async () => new Response('ok'));
    const f = withMaestroBypass(base as unknown as typeof fetch);
    await f('https://cardfacil.com/wp-json/');
    const headers = new Headers((base.mock.calls[0][1] as RequestInit).headers);
    expect(headers.get('X-Etus-Maestro')).toBe('bypass');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/lib/wp-runtime.test.ts`
Expected: FAIL — `withMaestroBypass is not a function` / not exported.

- [ ] **Step 3: Implement the wrapper and apply it in `wpDeps`**

In `src/lib/wp-runtime.ts`, add near the top (after the imports):

```ts
/**
 * Wrap a fetch so every WP REST subrequest carries `X-Etus-Maestro: bypass`.
 * When this worker runs behind maestro, the WP origin host may itself be a
 * maestro-routed zone; the header makes maestro pass the request straight to
 * origin (see etus-maestro src/main.ts) instead of re-entering the pipeline.
 */
export function withMaestroBypass(base: typeof fetch): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set('X-Etus-Maestro', 'bypass');
    return base(input, { ...init, headers });
  }) as typeof fetch;
}
```

Then in `wpDeps(...)`, change the `fetch` field (currently `fetch: globalThis.fetch.bind(globalThis)`):

```ts
    fetch: withMaestroBypass(globalThis.fetch.bind(globalThis)),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/lib/wp-runtime.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Full test + typecheck**

Run: `pnpm exec vitest run && pnpm exec astro check`
Expected: all green (existing suites unaffected — they inject their own mock `fetch` into `WpDeps` directly, bypassing `wpDeps`).

- [ ] **Step 6: Commit**

```bash
git add src/lib/wp-runtime.ts src/lib/wp-runtime.test.ts
git commit -m "feat: send X-Etus-Maestro bypass on server-side WP fetches"
```

---

### Task 3: Pipeline config — host-derived routes + device cache key

Replace the minimal Task-1 stubs (`routes: ['*']`, no `getCacheKey`) with host-derived routes and a device-dimensioned cache key.

**Files:**
- Modify: `src/index.ts`
- Test: `src/index.test.ts` (create)

**Interfaces:**
- Consumes: `SITES` from `src/lib/sites.config.ts` (`Record<string, { domains: string[] }>`); `version` from `package.json`.
- Produces: exported pure helpers `buildRoutes(sites)` and `deviceCacheKey(version, header)` for unit testing.

- [ ] **Step 1: Write the failing test**

Create `src/index.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildRoutes, deviceCacheKey } from './index';

describe('buildRoutes', () => {
  it('emits one host/* route per tenant domain, deduped', () => {
    const routes = buildRoutes({
      a: { domains: ['limitemais.com', 'www.limitemais.com'] },
      b: { domains: ['cardfacil.com'] },
    });
    expect(routes).toContain('limitemais.com/*');
    expect(routes).toContain('www.limitemais.com/*');
    expect(routes).toContain('cardfacil.com/*');
    expect(new Set(routes).size).toBe(routes.length);
  });
});

describe('deviceCacheKey', () => {
  it('includes version and device, defaulting device to desktop', () => {
    expect(deviceCacheKey('1.2.3', 'mobile')).toBe('1.2.3:mobile');
    expect(deviceCacheKey('1.2.3', undefined)).toBe('1.2.3:desktop');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/index.test.ts`
Expected: FAIL — `buildRoutes`/`deviceCacheKey` not exported.

- [ ] **Step 3: Implement helpers and wire them into the pipeline**

Edit `src/index.ts`. Add imports and helpers, and update `getConfig`/`createSession`/session:

```ts
import type { PipelineEntry, PipelineRequest, CacheKey } from './maestro-sdk';
import { SITES } from './lib/sites.config';
import { version as WORKER_VERSION } from '../package.json';

export function buildRoutes(sites: Record<string, { domains: string[] }>): string[] {
  return [...new Set(Object.values(sites).flatMap((s) => s.domains.map((d) => `${d}/*`)))];
}

export function deviceCacheKey(version: string, deviceHeader: string | undefined): string {
  return `${version}:${deviceHeader ?? 'desktop'}`;
}

const ROUTES = buildRoutes(SITES);
```

In `WpSitesSession`, add:

```ts
  getCacheKey(req: PipelineRequest): CacheKey {
    return { key: deviceCacheKey(WORKER_VERSION, req.headers['cf-device-type']), forbidCaching: false };
  }
```

In `getConfig()`, change `routes: ['*']` → `routes: ROUTES` and `enabled: true` → `enabled: ROUTES.length > 0`.

Add `"resolveJsonModule": true` to `tsconfig.json` compilerOptions if not present (needed for `import … from '../package.json'`).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/index.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck + re-bundle to confirm still builds**

Run: `pnpm exec astro check && pnpm build && pnpm exec wrangler deploy --env development --dry-run --outdir /tmp/wp-sites-bundle`
Expected: 0 errors; bundle succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts src/index.test.ts tsconfig.json
git commit -m "feat: host-derived pipeline routes + device-keyed cache key"
```

---

### Task 4: Cache alignment — public Cache-Control on SSR, retire middleware edge-cache

Make SSR responses cacheable by maestro (`Cache-Control: public`) and remove the now-redundant in-worker device edge-cache.

**Files:**
- Modify: `src/middleware.ts`
- Delete: `src/lib/cache.ts`, `src/lib/cache.test.ts` (only middleware imports them)
- Test: `src/middleware.test.ts` (create a focused test for the Cache-Control behavior) — if a middleware test harness doesn't exist, assert via the `applySecurity`-equivalent helper extracted below.

**Interfaces:**
- Produces: SSR responses carry `Cache-Control: public, max-age=300`.

- [ ] **Step 1: Write the failing test**

Create `src/middleware.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { withPublicCache, PAGE_MAX_AGE } from './middleware';

describe('withPublicCache', () => {
  it('sets public, max-age on the response', () => {
    const r = withPublicCache(new Response('<html></html>', { headers: { 'content-type': 'text/html' } }));
    expect(r.headers.get('cache-control')).toBe(`public, max-age=${PAGE_MAX_AGE}`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/middleware.test.ts`
Expected: FAIL — `withPublicCache`/`PAGE_MAX_AGE` not exported.

- [ ] **Step 3: Retire the edge-cache branch and add the public-cache helper**

In `src/middleware.ts`:

1. Remove the `import { CACHE_TTL_SEC, cacheKeyUrl, cacheTags, type EdgeCache, isRequestCacheable, parseCfDeviceType, serveWithCache } from './lib/cache';` line entirely.
2. Remove the whole `caches.default` device-cache block — the `const cfDevice = parseCfDeviceType(...)` through the `if (waitUntil && cfDevice && isRequestCacheable(...)) { return serveWithCache({...}); }` block, plus the now-unused `waitUntil` resolution above it.
3. Add the exported helper + constant (top-level, before `onRequest`):

```ts
/** SSR pages opt into maestro's full-page cache (composited with ads), mirroring
 *  etus-static-pages. Per-request identity is handled downstream in the pipeline,
 *  never in the cached body. */
export const PAGE_MAX_AGE = 300;
export function withPublicCache(r: Response): Response {
  r.headers.set('cache-control', `public, max-age=${PAGE_MAX_AGE}`);
  return r;
}
```

4. Change the final return so SSR responses get both security headers and public cache:

```ts
  return withPublicCache(applySecurity(await next()));
```

(The early `if (context.isPrerendered) return next();` stays — prerendered assets keep their own `_headers`. Static assets are served by the adapter before middleware runs, so they keep their adapter cache headers.)

- [ ] **Step 4: Delete the dead cache module**

```bash
git rm src/lib/cache.ts src/lib/cache.test.ts
```

- [ ] **Step 5: Run tests + typecheck to confirm nothing else used cache.ts**

Run: `pnpm exec vitest run && pnpm exec astro check`
Expected: all green. If `astro check` reports an unresolved import of `./lib/cache` from a file other than middleware, that file also needs updating — handle it before continuing.

- [ ] **Step 6: Re-bundle**

Run: `pnpm build && pnpm exec wrangler deploy --env development --dry-run --outdir /tmp/wp-sites-bundle`
Expected: bundle succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/middleware.ts src/middleware.test.ts
git commit -m "feat: public Cache-Control on SSR pages; retire in-worker device edge-cache"
```

---

### Task 5: Deploy scripts + README (mirror static-pages)

**Files:**
- Modify: `package.json` (scripts)
- Create: `README.md` (or update if present) documenting the maestro integration

- [ ] **Step 1: Add deploy scripts**

In `package.json` `scripts`, add (keep existing `dev`/`build`/`check`/`test`).
**Discovered in Task 1:** `wrangler.jsonc` has NO `main` (the adapter would bundle
`src/index.ts` circularly during `astro build`), so the pipeline entry is positional;
and `astro build` writes `.wrangler/deploy/config.json` redirecting wrangler to the
adapter's own config, which must be removed so our config + entry are used:

```json
    "deploy": "astro build && rm -f .wrangler/deploy/config.json && wrangler deploy src/index.ts -c wrangler.jsonc --env production",
    "deploy:dev": "astro build && rm -f .wrangler/deploy/config.json && wrangler deploy src/index.ts -c wrangler.jsonc --env development",
    "cf-typegen": "wrangler types"
```

- [ ] **Step 2: Write the README integration section**

Create/overwrite `README.md` with a "Wiring into maestro" section mirroring `etus-static-pages`:

```markdown
# etus-wp-sites-astro-front

A [maestro](../etus-maestro) **pipeline worker** that serves this multi-tenant
Astro SSR WordPress frontend. Invoked only via RPC from maestro (service binding
`WP_SITES`) — it has no HTTP routes of its own.

## How it works

`intercept()` reconstructs the request and runs the Astro Cloudflare SSR worker
(`dist/server/entry.mjs`, produced by `astro build`), returning the rendered page
(or static asset / 301). The response flows through the rest of the maestro
pipeline (ad insertion via MONETIZATION, analytics). Server-side WordPress REST
calls carry `X-Etus-Maestro: bypass` so they hit the WP origin directly instead
of re-entering maestro.

## Build & deploy

    pnpm deploy        # astro build && wrangler deploy --env production
    pnpm deploy:dev    # … --env development

Two-step: `astro build` emits dist/server (importable SSR) + dist/client (assets);
wrangler bundles src/index.ts + the SDK + the built SSR.

## Wiring into maestro (etus-maestro)

1. Service binding under each env in `wrangler.jsonc`:
   { "binding": "WP_SITES", "service": "etus-wp-sites-astro-front" }              // production
   { "binding": "WP_SITES", "service": "etus-wp-sites-astro-front-development" }  // development
2. PIPELINE_BINDINGS in src/main.ts: ["STATIC_PAGES", "WP_SITES", "MONETIZATION"]
   (after STATIC_PAGES so published static landing pages still win; before MONETIZATION).
3. Maestro routes must cover the tenant hosts (e.g. cardfacil.com/*, *limitemais.com/*).

**Deploy order:** deploy this worker BEFORE deploying maestro with the WP_SITES binding.
```

- [ ] **Step 3: Commit**

```bash
git add package.json README.md
git commit -m "docs: deploy scripts + maestro wiring README"
```

---

### Task 6: Maestro-side wiring — HANDOFF (NOT executed in this repo)

This task is **documentation only**. The maestro repo (`/Workspace/etus-maestro`) is
**out of scope** — these changes are applied separately by the maestro maintainers,
exactly as `etus-static-pages` documents (not edits in the worker repo). They are
already captured in this repo's `README.md` (Task 5). Do **not** edit the maestro repo
as part of executing this plan. Reproduced here for reference:

**What the maestro maintainer does (`/Workspace/etus-maestro`):**

- [ ] **Reference 1: Add the service binding under both envs**

In maestro `wrangler.jsonc`, add to `env.development.services` and `env.production.services`:

```jsonc
// development.services:
{ "binding": "WP_SITES", "service": "etus-wp-sites-astro-front-development" }
// production.services:
{ "binding": "WP_SITES", "service": "etus-wp-sites-astro-front" }
```

- **Reference 2: Insert WP_SITES into the pipeline order**

In maestro `src/main.ts`, change `PIPELINE_BINDINGS`:

```ts
const PIPELINE_BINDINGS: string[] = [
  "STATIC_PAGES",
  "WP_SITES",
  "MONETIZATION",
];
```

- **Reference 3: Ensure routes cover the tenant hosts**

In maestro `wrangler.jsonc` `env.production.routes`, confirm/add full-site coverage for each tenant served by this worker. `*limitemais.com/*` is already present. Add for cardfacil (and any other tenant in this repo's `SITES`):

```jsonc
{ "pattern": "cardfacil.com/*", "zone_name": "cardfacil.com" },
{ "pattern": "www.cardfacil.com/*", "zone_name": "cardfacil.com" }
```

For `env.development`, ensure the dev host you test with is routed (e.g. `cardfacil.com/*` already present in development).

> End of handoff reference — nothing in Task 6 is committed in this repo.

---

### Task 7: Verification

Integration verification (no unit test — exercise the real pipeline locally).

**Dependency:** Steps 2–5 (through-maestro e2e) require the **maestro handoff (Task 6)
to be applied** in `/Workspace/etus-maestro` — which is out of scope for this repo. If the
maestro side isn't wired yet, do **Step 1 only** (build + bundle proven green in Tasks 1–4)
and treat Steps 2–6 as the acceptance checklist to run once maestro is wired by its owners.

**Files:** none (verification only)

- [ ] **Step 1: Build this worker**

Run (in this repo): `pnpm build`
Expected: `dist/server/entry.mjs` + `dist/client/` present.

- [ ] **Step 2: Run both workers with service bindings**

In one shell, start this worker in dev:
```bash
pnpm exec wrangler dev --env development --port 8789
```
In another, start maestro pointing at it (maestro's dev resolves the `WP_SITES` service binding to the local worker via wrangler's multi-worker/service-binding dev):
```bash
cd /Users/etus_0181/Workspace/etus-maestro && pnpm dev
```
(If wrangler can't auto-resolve the local service binding, register this worker in maestro's dev session per maestro's README; document the exact command that worked.)

- [ ] **Step 3: Verify SSR is served through maestro**

```bash
curl -sS -H 'Host: cardfacil.com' http://127.0.0.1:8787/ -D - | head -40
```
Expected: 200, `content-type: text/html`, `cache-control: public, max-age=300`, body is the rendered Cardfácil home feed (not a WP origin page, not a 404). Ads/MONETIZATION tags present if that pipeline is active for the path.

- [ ] **Step 4: Verify a static landing page still wins (STATIC_PAGES first)**

If a static page is published for a path, request it and confirm it serves the bundled HTML (X-Static-Page header) rather than SSR.

- [ ] **Step 5: Verify assets and no WP loop**

```bash
curl -sS -H 'Host: cardfacil.com' http://127.0.0.1:8787/_astro/ -I   # an emitted asset path
```
Expected: assets resolve (served via ASSETS). Confirm in logs the worker's `/wp-json` subrequests carry `X-Etus-Maestro: bypass` and do not recurse (no repeated pipeline traces for the same WP URL).

- [ ] **Step 6: Document the working local recipe**

Append the exact commands that worked to `README.md` under a "Develop locally" section.

```bash
git add README.md
git commit -m "docs: local maestro dev recipe verified end-to-end"
```

---

## Deploy (post-merge, manual — not a code task)

1. Set real KV ids in `wrangler.jsonc` + `wrangler secret put WP_AUTH_LIMITEMAIS` / `WP_AUTH_CARDFACIL`.
2. `pnpm deploy` (this worker) **first**.
3. Then deploy maestro with the `WP_SITES` binding.

## Notes carried from the spec (verify during execution)
- **Set-Cookie & full-page cache:** confirm SSR responses carry no per-user `Set-Cookie` before relying on maestro's cache; if Astro sessions emit one, move it out of the cached path.
- **CSP nonce under caching:** the per-request nonce is now baked into the cached body; CSP must stay Report-Only (it is today) or move nonce handling out of the cached path.
- **`waitUntil`:** confirm the `ctx` maestro hands to `createSession`/`intercept` exposes `waitUntil` so the WP SWR (`WP_CACHE`) revalidation isn't cancelled.
