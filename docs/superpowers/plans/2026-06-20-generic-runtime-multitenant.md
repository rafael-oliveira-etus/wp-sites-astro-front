# Generic Runtime Multi-Tenant Worker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one generic build resolve the active tenant at request time from the `Host` header, instead of baking a single tenant per build.

**Architecture:** A single `sites.config.ts` holds every site's config plus a host→tenant resolver. `middleware.ts` resolves the tenant from `Host` and puts it on `Astro.locals.tenant`; components read it from there instead of an imported constant. `astro.config.ts` stops baking any tenant. Unknown hosts get a 404. Deploy collapses to one Worker serving all domains.

**Tech Stack:** Astro 6 (SSR, `output: 'server'`), `@astrojs/cloudflare` v13, Cloudflare Workers + KV, Zod (`tenantSchema`), Vitest, pnpm workspace.

## Global Constraints

- Single tenant today: `limitemais` (headless WP, `blog.wpBaseUrl: https://limitemais.com`, `defaultLocale: pt-br`, flat permalinks).
- Host match is **suffix-based**: `host === domain || host.endsWith('.' + domain)`. Never substring/"contains".
- Unknown host ⇒ **404 Response** (do NOT render `404.astro`, which needs a tenant). Known host + missing page ⇒ render branded `404.astro`.
- WP auth secret per tenant: `WP_AUTH_<ID>` (ID uppercased), e.g. `WP_AUTH_LIMITEMAIS`. Dev fallback: `process.env['WP_AUTH_<ID>']`.
- WP cache (`WP_CACHE`) keys are full WP URLs → already isolated per tenant; do not add prefixes.
- Sitemap is served by the WP origin; the front never generates one.
- All commands run from repo root `/Users/etus_0181/Workspace/etus-wp-sites-astro-front` with pnpm. Build/check need `TENANT_ID` ONLY as the dev fallback (no longer baked).
- Verify after each task: `pnpm exec vitest run` (where tests exist) and, for config/template tasks, `TENANT_ID=limitemais pnpm exec astro check`.

---

## File Structure

- Create `src/lib/sites.config.ts` — `SITES` map + `matchHost(host, sites)` (pure) + `resolveTenantByHost(host)`.
- Create `src/lib/sites.config.test.ts` — unit tests for `matchHost`.
- Modify `src/middleware.ts` — resolve tenant → `locals.tenant`; 404 unknown host; dev fallback.
- Modify `src/env.d.ts` — add `tenant: Tenant` to `App.Locals`.
- Modify the 11 `.astro` consumers — read `Astro.locals.tenant`.
- Modify `src/lib/tenant.ts` — drop the build-time `TENANT` const + `activeTenantId`; keep param-based helpers.
- Modify `src/lib/wp-runtime.ts` — per-tenant `WP_AUTH_<ID>`.
- Modify `src/components/BaseHead.astro` — `<link rel=sitemap>` → WP origin.
- Modify `astro.config.ts` — remove all per-tenant baking, `site`, `@astrojs/sitemap`, `i18n`; `publicDir: './public'`.
- Move `tenants/limitemais/public/{_headers,_redirects}` → `./public/`.
- Delete `tenants/`, `src/lib/tenant.build.ts`.
- Replace `wrangler.jsonc`; delete `wrangler.limitemais.json`, `sites.manifest.json`, `scripts/gen-wrangler.mjs`, `scripts/fleet-healthcheck.mjs`.

---

## Task 1: `sites.config.ts` — config map + host resolver

**Files:**
- Create: `src/lib/sites.config.ts`
- Test: `src/lib/sites.config.test.ts`
- Read (source data): `tenants/limitemais/tenant.yaml`

**Interfaces:**
- Produces:
  - `SITES: Record<string, Tenant>` — keyed by tenant id.
  - `matchHost(host: string | null | undefined, sites: Record<string, Tenant>): Tenant | null` — pure resolver.
  - `resolveTenantByHost(host: string | null | undefined): Tenant | null` — `matchHost(host, SITES)`.
- Consumes: `Tenant`, `tenantSchema` from `./schemas`.

- [ ] **Step 1: Write the failing test** for the pure matcher (synthetic fixture, no real data).

`src/lib/sites.config.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { matchHost } from './sites.config';
import type { Tenant } from './schemas';

const fake = (id: string, domains: string[]) => ({ id, domains } as unknown as Tenant);
const SITES = {
  limitemais: fake('limitemais', ['limitemais.com', 'www.limitemais.com']),
  other: fake('other', ['outro.com.br']),
};

describe('matchHost', () => {
  it('matches the apex domain exactly', () => {
    expect(matchHost('limitemais.com', SITES)?.id).toBe('limitemais');
  });
  it('matches www and arbitrary subdomains by suffix', () => {
    expect(matchHost('www.limitemais.com', SITES)?.id).toBe('limitemais');
    expect(matchHost('staging.limitemais.com', SITES)?.id).toBe('limitemais');
  });
  it('ignores port and trailing dot, case-insensitive', () => {
    expect(matchHost('LimiteMais.com:8788', SITES)?.id).toBe('limitemais');
    expect(matchHost('limitemais.com.', SITES)?.id).toBe('limitemais');
  });
  it('routes a different domain to its own tenant', () => {
    expect(matchHost('outro.com.br', SITES)?.id).toBe('other');
  });
  it('returns null for unknown hosts', () => {
    expect(matchHost('example.com', SITES)).toBeNull();
    expect(matchHost('localhost', SITES)).toBeNull();
    expect(matchHost(undefined, SITES)).toBeNull();
  });
  it('does NOT match a look-alike suffix (anti spoof)', () => {
    expect(matchHost('limitemais.com.evil.com', SITES)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/lib/sites.config.test.ts`
Expected: FAIL — `matchHost` not found (module missing).

- [ ] **Step 3: Generate the SITES data JSON from the existing YAML**

Run (prints the validated tenant object as JSON; copy the output into Step 4):
```bash
node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
const raw = readFileSync('tenants/limitemais/tenant.yaml','utf8');
const obj = { ...parse(raw), id: 'limitemais' };
process.stdout.write(JSON.stringify(obj, null, 2));
"
```
Expected: a JSON object (id, domains, defaultLocale, brand, seo, display, …).

- [ ] **Step 4: Write `src/lib/sites.config.ts`** — paste the JSON from Step 3 as the `limitemais` entry.

```ts
import { type Tenant } from './schemas';

// Single source of truth for every deployed site. Add a site = add an entry.
// Keyed by tenant id. The object below is the limitemais tenant.yaml, inlined.
export const SITES: Record<string, Tenant> = {
  limitemais: /* PASTE the JSON object from Step 3 here */ ,
};

// host (lowercased, port + trailing dot stripped) → tenant, by suffix match.
export function matchHost(
  host: string | null | undefined,
  sites: Record<string, Tenant>,
): Tenant | null {
  if (!host) return null;
  const h = host.toLowerCase().split(':')[0].replace(/\.$/, '');
  for (const site of Object.values(sites)) {
    for (const d of site.domains) {
      const dom = d.toLowerCase();
      if (h === dom || h.endsWith('.' + dom)) return site;
    }
  }
  return null;
}

export function resolveTenantByHost(host: string | null | undefined): Tenant | null {
  return matchHost(host, SITES);
}

/** Dev/preview fallback: pick a tenant by id (TENANT_ID) or the first site. */
export function fallbackTenant(id?: string): Tenant {
  if (id && SITES[id]) return SITES[id];
  const first = Object.values(SITES)[0];
  if (!first) throw new Error('SITES is empty');
  return first;
}
```

- [ ] **Step 5: Validate the inlined data once** with the schema (one-off; not committed).

Run:
```bash
node --input-type=module -e "
import { SITES } from './src/lib/sites.config.ts';
import { tenantSchema } from './src/lib/schemas.ts';
for (const [id, t] of Object.entries(SITES)) tenantSchema.parse(t);
console.log('SITES valid:', Object.keys(SITES).join(', '));
" 2>&1 | tail -3
```
Expected: `SITES valid: limitemais` (if it throws, fix the inlined JSON).
> Note: if Node can't import `.ts` directly, run with `pnpm exec vitest` via a throwaway test, or `npx tsx`. The committed validation lives in Step 1's test for `matchHost`; this step only sanity-checks the pasted data.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm exec vitest run src/lib/sites.config.test.ts`
Expected: PASS (7 assertions).

- [ ] **Step 7: Commit**

```bash
git add src/lib/sites.config.ts src/lib/sites.config.test.ts
git commit -m "feat: sites.config with host-based tenant resolver"
```

---

## Task 2: middleware resolves tenant → `locals.tenant`

**Files:**
- Modify: `src/middleware.ts`
- Modify: `src/env.d.ts` (add `tenant` to `App.Locals`)

**Interfaces:**
- Consumes: `resolveTenantByHost`, `fallbackTenant` from `./lib/sites.config`; `Tenant` from `./lib/schemas`.
- Produces: `Astro.locals.tenant: Tenant` for every successfully-resolved request.

- [ ] **Step 1: Add `tenant` to `App.Locals`** in `src/env.d.ts` (inside `declare namespace App { interface Locals { … } }`):
```ts
    /** Active tenant for this request, resolved from the Host by middleware. */
    tenant: import('./lib/schemas').Tenant;
```

- [ ] **Step 2: Resolve the tenant at the top of the middleware** in `src/middleware.ts`. After reading the request/host and before rendering, add:
```ts
import { resolveTenantByHost, fallbackTenant } from './lib/sites.config';
// …inside the onRequest handler, early:
const host = context.request.headers.get('host');
let tenant = resolveTenantByHost(host);
if (!tenant && import.meta.env.DEV) {
  // Dev/preview on localhost: no Host match → use TENANT_ID or the first site.
  tenant = fallbackTenant(process.env.TENANT_ID);
}
if (!tenant) {
  return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
context.locals.tenant = tenant;
```
> Place this BEFORE any existing logic that assumes a tenant. Keep the existing nonce/device/country logic intact, after this block.

- [ ] **Step 3: Typecheck**

Run: `TENANT_ID=limitemais pnpm exec astro check 2>&1 | tail -5`
Expected: 0 errors (consumers still import the old `TENANT` const — fixed in Task 3; check may report errors there only after Task 3 starts; at this point it should still pass because `tenant.ts` const still exists).

- [ ] **Step 4: Commit**

```bash
git add src/middleware.ts src/env.d.ts
git commit -m "feat: middleware resolves tenant from Host into locals"
```

---

## Task 3: components read `Astro.locals.tenant`; prune `tenant.ts`

**Files (modify each `.astro`):**
`src/components/BaseHead.astro`, `src/components/Header.astro`, `src/components/AnalyticsBoot.astro`, `src/components/ConsentBanner.astro`, `src/components/PixelsLoader.astro`, `src/components/TurnstileWidget.astro`, `src/layouts/BaseLayout.astro`, `src/layouts/BlogLayout.astro`, `src/pages/index.astro`, `src/pages/[...slug].astro`, `src/pages/404.astro`.
- Modify: `src/lib/tenant.ts`

**Interfaces:**
- Consumes: `Astro.locals.tenant` (Task 2).
- Produces: `tenant.ts` no longer exports `TENANT`/`activeTenantId`; keeps `localeDisplay`, `siteOrigin`, and any other param-based helpers.

- [ ] **Step 1: In each `.astro` file**, remove `TENANT` from its `…/lib/tenant` import (keep other named imports such as `localeDisplay`) and add, as the first line of the frontmatter after imports:
```ts
const TENANT = Astro.locals.tenant;
```
Find each occurrence with:
```bash
grep -rn "import .*\bTENANT\b.*lib/tenant'" src/components src/layouts src/pages
```
> Pages `index.astro`/`[...slug].astro`/`404.astro` use `TENANT` in top-level frontmatter — `Astro.locals.tenant` is available there in SSR.

- [ ] **Step 2: Prune `src/lib/tenant.ts`** — delete the `TENANT` proxy const, `activeTenantId()`, and the `import.meta.env.TENANT_JSON` reader. KEEP `localeDisplay(tenant, locale)`, `siteOrigin(tenant)`, and any other functions that take `tenant` as a parameter. Verify nothing else imports the removed symbols:
```bash
grep -rn "activeTenantId\|TENANT_JSON\|import { TENANT" src/ | grep -v "Astro.locals.tenant"
```
Expected: only the (now-removed) lines; no remaining consumers.

- [ ] **Step 3: Typecheck**

Run: `TENANT_ID=limitemais pnpm exec astro check 2>&1 | tail -8`
Expected: 0 errors. (If a file still references `TENANT` without the new const, add the const.)

- [ ] **Step 4: Run unit tests**

Run: `pnpm exec vitest run`
Expected: all pass (param-based libs unaffected).

- [ ] **Step 5: Commit**

```bash
git add src/components src/layouts src/pages src/lib/tenant.ts
git commit -m "refactor: read tenant from Astro.locals; drop build-time TENANT const"
```

---

## Task 4: `astro.config.ts` generic (no baked tenant)

**Files:**
- Modify: `astro.config.ts`

- [ ] **Step 1: Remove per-tenant baking.** Delete: the `activeTenantIdFromEnv`/`loadTenant`/`tenantPublicDir` imports and their use; `TENANT_ID`, `TENANT_OBJ`, `TENANT_JSON`, `TENANT_LOGO_SVG`; the `vite.define` entries `TENANT_ID`/`TENANT_JSON`/`TENANT_LOGO_SVG`; the `readFileSync`/`join` imports if now unused; `site`; the entire `@astrojs/sitemap` import + integration; the `i18n` block. Set `publicDir: './public'` and `trailingSlash: 'ignore'`.

Resulting `astro.config.ts` (target shape):
```ts
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  output: 'server',
  adapter: cloudflare({ imageService: 'passthrough' }),
  trailingSlash: 'ignore',
  publicDir: './public',
  vite: {
    ssr: { noExternal: ['@etus/ads', '@etus/seo'] },
  },
  build: { inlineStylesheets: 'always', format: 'directory' },
  prefetch: false,
  compressHTML: true,
});
```
> If any component still reads `import.meta.env.PUBLIC_EVENTS_API_URL`, that's a runtime env var (not baked here) and is unaffected.

- [ ] **Step 2: Create the shared `public/` and move edge files**

Run:
```bash
mkdir -p public
git mv tenants/limitemais/public/_headers public/_headers
git mv tenants/limitemais/public/_redirects public/_redirects
```

- [ ] **Step 3: Build to verify the generic config compiles** (uses dev fallback `TENANT_ID`).

Run: `TENANT_ID=limitemais pnpm exec astro build 2>&1 | tail -15`
Expected: `[build] Complete!`, no errors. (No more `[@astrojs/sitemap]` line.)

- [ ] **Step 4: Commit**

```bash
git add astro.config.ts public/
git commit -m "refactor: generic astro.config (no baked tenant, shared publicDir)"
```

---

## Task 5: delete `tenants/` and `tenant.build.ts`

**Files:**
- Delete: `tenants/` (whole tree), `src/lib/tenant.build.ts`

- [ ] **Step 1: Confirm nothing references them**

Run:
```bash
grep -rn "tenant.build\|tenants/\|TENANTS_DIR\|loadTenant\|tenantPublicDir" src/ astro.config.ts | grep -v "node_modules"
```
Expected: empty (Task 4 removed the last astro.config refs).

- [ ] **Step 2: Delete**

Run:
```bash
git rm -r tenants
git rm src/lib/tenant.build.ts
```

- [ ] **Step 3: Build + typecheck again**

Run: `TENANT_ID=limitemais pnpm exec astro check 2>&1 | tail -5 && TENANT_ID=limitemais pnpm exec astro build 2>&1 | tail -5`
Expected: 0 errors; build Complete.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: remove tenants/ folder and tenant.build (config now in sites.config)"
```

---

## Task 6: per-tenant WP auth in `wp-runtime.ts`

**Files:**
- Modify: `src/lib/wp-runtime.ts`
- Modify callers that build deps: `src/pages/index.astro`, `src/pages/[...slug].astro`, and any component calling `wpMenu`/`boltConfig`/`footerData` (grep below).

**Interfaces:**
- Produces: `wpDepsFromRuntime(baseUrl: string, tenantId: string)`, `wpMenu(baseUrl, candidates, tenantId)`, `boltConfig(baseUrl, tenantId)`, `footerData(baseUrl, tenantId)`.

- [ ] **Step 1: Add a failing test** for the secret-name resolution helper.

`src/lib/wp-runtime.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { wpAuthEnvKey } from './wp-runtime';

describe('wpAuthEnvKey', () => {
  it('builds WP_AUTH_<ID> uppercased', () => {
    expect(wpAuthEnvKey('limitemais')).toBe('WP_AUTH_LIMITEMAIS');
  });
  it('uppercases mixed/hyphenated ids', () => {
    expect(wpAuthEnvKey('tarjetas-ar')).toBe('WP_AUTH_TARJETAS_AR');
  });
});
```

- [ ] **Step 2: Run it (fails)**

Run: `pnpm exec vitest run src/lib/wp-runtime.test.ts`
Expected: FAIL — `wpAuthEnvKey` not exported.

- [ ] **Step 3: Implement in `wp-runtime.ts`.** Add the helper and thread `tenantId`:
```ts
export function wpAuthEnvKey(tenantId: string): string {
  return 'WP_AUTH_' + tenantId.toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

export async function wpDepsFromRuntime(baseUrl: string, tenantId: string): Promise<WpDeps> {
  const key = wpAuthEnvKey(tenantId);
  let kv: KvLike | null = null;
  let secret: string | undefined;
  try {
    const mod = await import('cloudflare:workers');
    const env = (mod as unknown as { env?: Record<string, unknown> }).env ?? {};
    kv = (env.WP_CACHE as KvLike | undefined) ?? null;
    secret = env[key] as string | undefined;
  } catch {
    kv = null;
  }
  if (!secret && typeof process !== 'undefined') secret = process.env?.[key];
  const authHeader = secret ? `Basic ${btoa(secret)}` : undefined;
  return wpDeps({ baseUrl, kv, authHeader });
}
```
Update `wpMenu`, `boltConfig`, `footerData` to accept `tenantId` and pass it to `wpDepsFromRuntime`.

- [ ] **Step 4: Update callers** to pass `TENANT.id`. Find them:
```bash
grep -rn "wpDepsFromRuntime\|wpMenu(\|boltConfig(\|footerData(" src/ | grep -v "wp-runtime"
```
For each call, add `TENANT.id` (where `TENANT = Astro.locals.tenant`) as the new argument.

- [ ] **Step 5: Rename the dev secret** so the new key resolves.

Run:
```bash
# .dev.vars already has WP_AUTH_LIMITEMAIS — confirm; if it's named WP_AUTH, rename:
grep -q '^WP_AUTH_LIMITEMAIS=' .dev.vars && echo "ok" || echo "RENAME WP_AUTH -> WP_AUTH_LIMITEMAIS in .dev.vars"
cp .dev.vars dist/server/.dev.vars 2>/dev/null || true
```

- [ ] **Step 6: Tests + typecheck**

Run: `pnpm exec vitest run && TENANT_ID=limitemais pnpm exec astro check 2>&1 | tail -5`
Expected: all pass; 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/wp-runtime.ts src/lib/wp-runtime.test.ts src/pages src/components
git commit -m "feat: per-tenant WP auth via WP_AUTH_<ID>"
```

---

## Task 7: `<link rel=sitemap>` → WP origin

**Files:**
- Modify: `src/components/BaseHead.astro`

- [ ] **Step 1: Replace the static sitemap link.** Change:
```astro
<link rel="sitemap" href="/sitemap-index.xml" transition:persist="head-sitemap" />
```
to (only when the tenant is headless WP):
```astro
{TENANT.blog?.wpBaseUrl && (
  <link rel="sitemap" href={`${TENANT.blog.wpBaseUrl}/sitemap_index.xml`} transition:persist="head-sitemap" />
)}
```

- [ ] **Step 2: Typecheck + confirm the link**

Run: `TENANT_ID=limitemais pnpm exec astro check 2>&1 | tail -3`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/BaseHead.astro
git commit -m "feat: sitemap served by WP origin (Yoast), not the front"
```

---

## Task 8: deploy — single Worker, all domains

**Files:**
- Modify: `wrangler.jsonc`
- Delete: `wrangler.limitemais.json`, `sites.manifest.json`, `scripts/gen-wrangler.mjs`, `scripts/fleet-healthcheck.mjs`

- [ ] **Step 1: Rewrite `wrangler.jsonc`** as one Worker serving every site's domains, shared KV, per-tenant secrets provisioned out-of-band.
```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "frontend",
  "main": "@astrojs/cloudflare/entrypoints/server",
  "compatibility_date": "2026-06-01",
  "compatibility_flags": ["nodejs_compat"],
  "assets": { "binding": "ASSETS", "directory": "./dist", "not_found_handling": "404-page", "html_handling": "drop-trailing-slash" },
  "kv_namespaces": [
    { "binding": "SESSION", "id": "PASTE_SESSION_KV_ID" },
    { "binding": "WP_CACHE", "id": "PASTE_WP_CACHE_KV_ID" }
  ],
  "routes": [
    { "pattern": "limitemais.com/*", "zone_name": "limitemais.com" },
    { "pattern": "www.limitemais.com/*", "zone_name": "limitemais.com" }
  ],
  "observability": { "enabled": true }
}
```
> Adding a site later = add its `tenant.yaml`-equivalent entry to `SITES` AND two `routes` lines here. Per-tenant secret set via `wrangler secret put WP_AUTH_<ID>`.

- [ ] **Step 2: Remove the obsolete per-site fleet tooling**

Run:
```bash
git rm wrangler.limitemais.json sites.manifest.json scripts/gen-wrangler.mjs scripts/fleet-healthcheck.mjs
```

- [ ] **Step 3: Confirm nothing references removed files**

Run:
```bash
grep -rn "sites.manifest\|gen-wrangler\|fleet-healthcheck\|wrangler.limitemais" src/ scripts/ README.md docs/ 2>/dev/null | grep -v "docs/superpowers"
```
Expected: empty (update README if it references them).

- [ ] **Step 4: Build (config-only change; no runtime impact)**

Run: `TENANT_ID=limitemais pnpm exec astro build 2>&1 | tail -5`
Expected: build Complete.

- [ ] **Step 5: Commit**

```bash
git add wrangler.jsonc README.md 2>/dev/null; git commit -m "chore: single generic Worker for all domains; retire per-site fleet tooling"
```

---

## Task 9: end-to-end validation (dev + preview + Playwright by Host)

**Files:**
- Use: `scripts/shoot.mjs` (extend to send a `Host` header)

- [ ] **Step 1: Full quality gate**

Run:
```bash
pnpm exec vitest run && TENANT_ID=limitemais pnpm exec astro check 2>&1 | tail -3 && TENANT_ID=limitemais pnpm exec astro build 2>&1 | tail -3
```
Expected: tests pass; 0 errors; build Complete.

- [ ] **Step 2: Dev server renders limitemais on localhost (fallback)**

Run:
```bash
TENANT_ID=limitemais pnpm exec astro dev --port 4321 > /tmp/dev.log 2>&1 &
sleep 6
curl -s -o /dev/null -w "dev / -> %{http_code}\n" http://localhost:4321/
```
Expected: HTTP 200.

- [ ] **Step 3: Preview (workerd) resolves by Host header; unknown host → 404**

Run:
```bash
TENANT_ID=limitemais pnpm exec astro build >/dev/null 2>&1
cp .dev.vars dist/server/.dev.vars 2>/dev/null || true
pnpm exec wrangler dev -c dist/server/wrangler.json --port 8788 > /tmp/wr.log 2>&1 &
sleep 16
curl -s -o /dev/null -w "host=limitemais.com -> %{http_code}\n" -H "Host: limitemais.com" http://localhost:8788/
curl -s -o /dev/null -w "host=unknown.com   -> %{http_code}\n" -H "Host: unknown.example" http://localhost:8788/
```
Expected: `limitemais.com -> 200`, `unknown.example -> 404`.

- [ ] **Step 4: Playwright screenshots by Host (desktop + mobile)**

Extend `scripts/shoot.mjs` to set `extraHTTPHeaders: { Host: 'limitemais.com' }` on the context (point BASE at `http://localhost:8788`), then:
```bash
node scripts/shoot.mjs http://localhost:8788
```
Expected: 4 screenshots, status 200, 0 console errors. Inspect them.

- [ ] **Step 5: Final commit (if shoot.mjs changed)**

```bash
git add scripts/shoot.mjs
git commit -m "test: Playwright host-based validation for generic worker"
```

---

## Self-Review (completed)

- **Spec coverage:** §1 sites.config→T1; §2 middleware/404/dev→T2; §3 locals refactor→T3; §4 astro.config→T4; §5 tenants/ removal→T5; §6 WP auth→T6 (cache no-op noted); §7 sitemap→T7; §8 deploy→T8; testing→T1/T6/T9. All covered.
- **Placeholders:** the only intentional fill-in is the SITES data object (generated deterministically from the existing YAML in T1 Step 3) and KV ids in wrangler (provisioned out-of-band) — both are data, not logic gaps.
- **Type consistency:** `matchHost`/`resolveTenantByHost`/`fallbackTenant`, `wpAuthEnvKey`, `Astro.locals.tenant`, and the `wpDepsFromRuntime(baseUrl, tenantId)` signature are used consistently across T1, T2, T3, T6.
