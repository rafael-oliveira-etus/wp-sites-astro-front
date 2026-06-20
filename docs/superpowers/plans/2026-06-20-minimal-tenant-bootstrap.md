# Minimal Tenant Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a new site be added with only a bootstrap entry in `SITES` (id, domains, locales, `wpAuthEnv`, `blog.wpBaseUrl`) — `display`/`brand`/`seo`/`legal` become optional, sourced from WordPress/BOLT at runtime or from a single baked-in pt-br default.

**Architecture:** Make `display`/`seo`/`legal` optional and `brand` defaulted in the tenant Zod schema. UI chrome strings fall back to one shared `DEFAULT_DISPLAY` (pt-br) constant via `localeDisplay()`. Site name is overlaid from the BOLT config (`/wp-json/bolt/v1/config`) on the surfaces that render it. The WP auth secret name is declared explicitly per tenant via `wpAuthEnv` instead of being derived by uppercasing the id.

**Tech Stack:** Astro 6 SSR, Zod 4, Vitest, TypeScript, Cloudflare Workers (workerd).

## Global Constraints

- Default locale copy is **pt-br** (the only locale in use). `DEFAULT_DISPLAY` is pt-br.
- WP auth secret convention stays `WP_AUTH_<ID>` (uppercase) for new sites, but the value is now **declared literally** in `wpAuthEnv` — casing is no longer derived.
- `blog.wpBaseUrl` must be the **real WP origin**, never the public host the Worker serves (else SSR fetch loop). For cardfacil the Worker serves `astro-dev.cardfacil.com`; WP is the apex `cardfacil.com`.
- `domains` uses suffix match (`matchHost`): `["cardfacil.com"]` already covers `www.` and `astro-dev.`.
- Images are linked from source — never download/optimize/store. Do not touch image markup here.
- `limitemais` must keep parsing and rendering identically (it still carries a full `display`/`brand`/`seo`).
- Run commands with `pnpm exec`. Type-check with `TENANT_ID=limitemais pnpm exec astro check`.

---

### Task 1: Schema — optional `display`/`seo`/`legal`, defaulted `brand`, add `wpAuthEnv`

**Files:**
- Modify: `src/lib/schemas.ts` (the `tenantSchema` object, ~lines 332-459; `brand`/`seo`/`display` fields and the `DEFAULT_BRAND` constant)
- Test: `src/lib/schemas.test.ts` (create if absent)

**Interfaces:**
- Produces: `tenantSchema` accepts a tenant with no `display`, `seo`, or `legal`; `brand` defaults to `DEFAULT_BRAND`. New optional field `wpAuthEnv?: string` on `Tenant`. Exported constant `DEFAULT_BRAND` of the `brand` shape.

- [ ] **Step 1: Write the failing test**

Create/append `src/lib/schemas.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { tenantSchema, DEFAULT_BRAND } from './schemas';

describe('tenantSchema minimal bootstrap', () => {
  const minimal = {
    id: 'cardfacil',
    domains: ['cardfacil.com'],
    defaultLocale: 'pt-br',
    locales: ['pt-br'],
    wpAuthEnv: 'WP_AUTH_CARDFACIL',
    blog: { wpBaseUrl: 'https://cardfacil.com' },
  };

  it('parses a minimal tenant with no display/seo/legal', () => {
    const t = tenantSchema.parse(minimal);
    expect(t.id).toBe('cardfacil');
    expect(t.display).toBeUndefined();
    expect(t.seo).toBeUndefined();
    expect(t.legal).toBeUndefined();
    expect(t.wpAuthEnv).toBe('WP_AUTH_CARDFACIL');
  });

  it('defaults brand to DEFAULT_BRAND when omitted', () => {
    const t = tenantSchema.parse(minimal);
    expect(t.brand).toEqual(DEFAULT_BRAND);
  });

  it('keeps wpAuthEnv optional', () => {
    const { wpAuthEnv, ...noAuth } = minimal;
    const t = tenantSchema.parse(noAuth);
    expect(t.wpAuthEnv).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/lib/schemas.test.ts`
Expected: FAIL — `tenantSchema` currently requires `brand`/`seo`/`display`; `DEFAULT_BRAND` not exported.

- [ ] **Step 3: Add `DEFAULT_BRAND` and make the fields optional/defaulted**

In `src/lib/schemas.ts`, just above `export const tenantSchema = z.object({`, add:

```ts
// Neutral brand palette used when a tenant declares no `brand`. Real colors are
// overlaid from the BOLT config at runtime on the blog path (BlogLayout); this
// default only governs non-blog chrome (BaseLayout / themeColor).
export const DEFAULT_BRAND = {
  primaryColor: '#1f2937',
  secondaryColor: '#0f172a',
  bgColor: '#ffffff',
  textColor: '#0a0a0a',
  mutedTextColor: '#555851',
  logo: { src: 'logo.svg', width: 119, height: 31 },
} as const;
```

In the `tenantSchema` object, change the three fields:

```ts
  // was: brand: z.object({ ... }),
  brand: z
    .object({
      primaryColor: z.string(),
      secondaryColor: z.string(),
      bgColor: z.string(),
      textColor: z.string(),
      mutedTextColor: z.string(),
      logo: z
        .object({
          src: z.string().default('logo.svg'),
          width: z.number().int().positive().default(119),
          height: z.number().int().positive().default(31),
        })
        .default({ src: 'logo.svg', width: 119, height: 31 }),
    })
    .default(DEFAULT_BRAND),
```

```ts
  // was: seo: z.object({ ... }),
  seo: z
    .object({
      twitterHandle: z.string(),
      organization: z.object({
        /* ...unchanged inner object... */
      }),
    })
    .optional(),
```

```ts
  // was: display: z.record(localeStringSchema, localeDisplaySchema),
  display: z.record(localeStringSchema, localeDisplaySchema).optional(),
```

Add the new field near `id` (e.g. right after `domains`):

```ts
  // Exact env var name holding this tenant's WordPress auth secret
  // ("user:application_password"). Declared literally so casing can't drift
  // (see wpAuthEnvKeyFor). When absent, falls back to WP_AUTH_<ID uppercased>.
  wpAuthEnv: z.string().optional(),
```

(`legal` is already `.optional()` — leave it.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/lib/schemas.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/schemas.ts src/lib/schemas.test.ts
git commit -m "feat(schema): optional display/seo/legal, defaulted brand, add wpAuthEnv"
```

---

### Task 2: `DEFAULT_DISPLAY` constant + `localeDisplay` fallback

**Files:**
- Create: `src/lib/default-display.ts`
- Modify: `src/lib/sites.config.ts` (the `limitemais` `display["pt-br"]` block — reference it as the source of the verbatim values)
- Modify: `src/lib/tenant.ts:9-24` (`localeDisplay`)
- Test: `src/lib/tenant.test.ts` (create if absent)

**Interfaces:**
- Consumes: `LocaleDisplay` type from `./schemas`; `Tenant.display` now optional (Task 1).
- Produces: `export const DEFAULT_DISPLAY: LocaleDisplay`. `localeDisplay(tenant, locale)` returns `DEFAULT_DISPLAY` when the tenant has no matching/`defaultLocale` display, instead of throwing.

- [ ] **Step 1: Write the failing test**

Create `src/lib/tenant.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { localeDisplay } from './tenant';
import { DEFAULT_DISPLAY } from './default-display';
import { DEFAULT_BRAND } from './schemas';
import type { Tenant } from './schemas';

const base = {
  id: 'x',
  domains: ['x.com'],
  defaultLocale: 'pt-br',
  locales: ['pt-br'],
  brand: DEFAULT_BRAND,
} as unknown as Tenant;

describe('localeDisplay fallback', () => {
  it('returns DEFAULT_DISPLAY when tenant has no display', () => {
    const t = { ...base, display: undefined } as unknown as Tenant;
    expect(localeDisplay(t, 'pt-br')).toBe(DEFAULT_DISPLAY);
  });

  it('returns the tenant block when present', () => {
    const custom = { ...DEFAULT_DISPLAY, siteName: 'Custom' };
    const t = { ...base, display: { 'pt-br': custom } } as unknown as Tenant;
    expect(localeDisplay(t, 'pt-br').siteName).toBe('Custom');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/lib/tenant.test.ts`
Expected: FAIL — `./default-display` does not exist.

- [ ] **Step 3: Create `DEFAULT_DISPLAY` and update `localeDisplay`**

Create `src/lib/default-display.ts`. The body is the **verbatim object** currently at `src/lib/sites.config.ts` in `SITES.limitemais.display["pt-br"]` (the block spanning `siteName` through `footer`), with `siteName` and `description` blanked so the BOLT/per-page values win:

```ts
import type { LocaleDisplay } from './schemas';

// Shared pt-br UI chrome strings (skip link, pagination, a11y labels, 404,
// consent, footer copy). Used when a tenant declares no `display`. siteName /
// description are intentionally empty — siteName is overlaid from the BOLT
// config at render; per-page description comes from the WP post/page.
export const DEFAULT_DISPLAY: LocaleDisplay = {
  siteName: '',
  siteShortName: '',
  tagline: '',
  description: '',
  // ↓↓↓ copy verticals/nav/legalConsent/ui/notFound/noscript/footer VERBATIM
  //     from sites.config.ts SITES.limitemais.display["pt-br"] ↓↓↓
  verticals: {
    cc: 'Cartão de Crédito',
    loans: 'Empréstimo',
    insurance: 'Seguros',
    education: 'Educação Financeira',
  },
  nav: { blog: 'Blog', home: 'Início' },
  legalConsent: '',
  ui: {
    skipLink: 'Pular para o conteúdo principal',
    sponsored: 'Patrocinado',
    by: 'Por',
    minRead: 'min de leitura',
    continueLabel: 'Continuar',
    relatedPosts: 'Artigos relacionados',
    breadcrumbAria: 'Trilha de navegação',
    primaryNavAria: 'Principal',
    progressAria: 'Progresso do quiz',
    languageNavAria: 'Idioma',
    noPostsYet: 'Ainda não há artigos — volte em breve.',
    back: 'Voltar',
    onThisPage: 'Nesta página',
    share: 'Compartilhar',
    copyLink: 'Copiar link',
    linkCopied: 'Link copiado',
    prevPage: 'Anterior',
    nextPage: 'Próximo',
    pageLabel: 'Página',
    paginationAria: 'Paginação',
    reviewedBy: 'Revisado por',
    keyTakeaways: 'Key takeaways',
    faqHeading: 'Perguntas frequentes',
    editorsPick: 'Escolha do editor',
    affiliateDisclosure:
      'Podemos receber comissão de parceiros. Isso não afeta nossas recomendações.',
    adLabel: 'Publicidade',
    menuToggle: 'Menu',
  },
  notFound: {
    heading: 'Página não encontrada',
    subheading: 'A página que você procura não existe ou foi movida.',
    cta: 'Voltar ao início',
  },
  noscript: {
    quiz: 'Este quiz requer JavaScript. Habilite-o no seu navegador para continuar.',
    capture:
      'Enviar o formulário requer JavaScript. Habilite-o no seu navegador para receber sua recomendação.',
  },
  footer: { links: [], contactLabel: 'Contato' },
};
```

In `src/lib/tenant.ts`, replace `localeDisplay` (lines 9-24) with:

```ts
import { type Tenant } from './schemas';
import { DEFAULT_DISPLAY } from './default-display';

export function localeDisplay(tenant: Tenant, locale: string) {
  const display = tenant.display?.[locale];
  if (display) return display;
  const fallback = tenant.display?.[tenant.defaultLocale];
  if (fallback) {
    if (locale !== tenant.defaultLocale) {
      console.warn(
        `localeDisplay fallback: tenant=${tenant.id} requested=${locale} → ${tenant.defaultLocale}`,
      );
    }
    return fallback;
  }
  // No per-tenant display at all → shared app default (minimal-bootstrap tenant).
  return DEFAULT_DISPLAY;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/lib/tenant.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/default-display.ts src/lib/tenant.ts src/lib/tenant.test.ts
git commit -m "feat(tenant): DEFAULT_DISPLAY pt-br + localeDisplay falls back to it"
```

---

### Task 3: Explicit WP auth env resolution (`wpAuthEnvKeyFor`)

**Files:**
- Modify: `src/lib/wp-runtime.ts` (`wpAuthEnvKey` area ~lines 8-59; `wpDepsFromRuntime`, `wpMenu`, `boltConfig`, `footerData`)
- Modify call sites: `src/components/Header.astro:19,21`, `src/components/Footer.astro:15`, `src/layouts/BlogLayout.astro:27`
- Test: `src/lib/wp-runtime.test.ts`

**Interfaces:**
- Consumes: `Tenant.wpAuthEnv` (Task 1), existing `wpAuthEnvKey(id)`.
- Produces: `wpAuthEnvKeyFor(tenant: Pick<Tenant, 'id' | 'wpAuthEnv'>): string`. `wpDepsFromRuntime(baseUrl, authKey)`, `wpMenu(baseUrl, candidates, authKey)`, `boltConfig(baseUrl, authKey)`, `footerData(baseUrl, authKey)` — second/third arg is now the **resolved env key string**, not the tenant id.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/wp-runtime.test.ts`:

```ts
import { wpAuthEnvKeyFor } from './wp-runtime';

describe('wpAuthEnvKeyFor', () => {
  it('prefers the explicit wpAuthEnv', () => {
    expect(wpAuthEnvKeyFor({ id: 'cardfacil', wpAuthEnv: 'WP_AUTH_CARDFACIL' }))
      .toBe('WP_AUTH_CARDFACIL');
  });
  it('falls back to the derived WP_AUTH_<ID> when wpAuthEnv is absent', () => {
    expect(wpAuthEnvKeyFor({ id: 'limitemais' })).toBe('WP_AUTH_LIMITEMAIS');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/lib/wp-runtime.test.ts`
Expected: FAIL — `wpAuthEnvKeyFor` is not exported.

- [ ] **Step 3: Add the resolver and thread the key through**

In `src/lib/wp-runtime.ts`, add after `wpAuthEnvKey` (line 11):

```ts
/** Resolve the WP auth env var name for a tenant: explicit `wpAuthEnv` wins,
 *  else the derived `WP_AUTH_<ID>` (back-compat). */
export function wpAuthEnvKeyFor(tenant: { id: string; wpAuthEnv?: string }): string {
  return tenant.wpAuthEnv ?? wpAuthEnvKey(tenant.id);
}
```

Change `wpDepsFromRuntime` to take the resolved key (it only used the id to derive the key):

```ts
export async function wpDepsFromRuntime(baseUrl: string, authKey: string): Promise<WpDeps> {
  let kv: KvLike | null = null;
  let secret: string | undefined;
  try {
    const mod = await import('cloudflare:workers');
    const env = (mod as unknown as { env?: Record<string, unknown> }).env ?? {};
    kv = (env.WP_CACHE as KvLike | undefined) ?? null;
    secret = env[authKey] as string | undefined;
  } catch {
    kv = null;
  }
  if (!secret && typeof process !== 'undefined') secret = process.env?.[authKey];
  const authHeader = secret ? `Basic ${btoa(secret)}` : undefined;
  return wpDeps({ baseUrl, kv, authHeader });
}
```

Update the three wrappers to take `authKey` and pass it through:

```ts
export async function wpMenu(baseUrl: string, candidates: Array<string | undefined>, authKey: string): Promise<WpMenuItem[]> {
  const locs = candidates.filter((c): c is string => Boolean(c));
  if (locs.length === 0) return [];
  const deps = await wpDepsFromRuntime(baseUrl, authKey);
  for (const loc of locs) {
    const tree = await getMenuTree(deps, loc);
    if (tree.length > 0) return tree;
  }
  return [];
}

export async function boltConfig(baseUrl: string, authKey: string): Promise<BoltConfig | null> {
  const deps = await wpDepsFromRuntime(baseUrl, authKey);
  return getBoltConfig(deps);
}

export async function footerData(baseUrl: string, authKey: string): Promise<{ widgets: FooterWidgets; first: WpMenuItem[]; second: WpMenuItem[] }> {
  const deps = await wpDepsFromRuntime(baseUrl, authKey);
  const [widgets, menus] = await Promise.all([getFooterWidgets(deps), getFooterMenus(deps)]);
  return { widgets, first: menus.first, second: menus.second };
}
```

Update call sites to pass `wpAuthEnvKeyFor(TENANT)`:

- `src/components/Header.astro:5` import: `import { wpMenu, boltConfig, wpAuthEnvKeyFor } from '../lib/wp-runtime';`
- `src/components/Header.astro` — add after `const wpBaseUrl = TENANT.blog?.wpBaseUrl;`: `const authKey = wpAuthEnvKeyFor(TENANT);`
- `Header.astro:19`: `? await wpMenu(wpBaseUrl, [TENANT.blog?.menus?.header, 'header-menu', 'primary', 'main', 'header', 'menu-1', 'top'], authKey)`
- `Header.astro:21`: `const cfg = wpBaseUrl ? await boltConfig(wpBaseUrl, authKey) : null;`
- `src/layouts/BlogLayout.astro:11` import: add `wpAuthEnvKeyFor`; add `const authKey = wpAuthEnvKeyFor(TENANT);` near `wpBaseUrl`; line 27: `const cfg = wpBaseUrl ? await boltConfig(wpBaseUrl, authKey) : null;`
- `src/components/Footer.astro:3` import: `import { footerData, wpAuthEnvKeyFor } from "../lib/wp-runtime";`; add `const authKey = wpAuthEnvKeyFor(TENANT);`; line 15: `const fd = wpBaseUrl ? await footerData(wpBaseUrl, authKey) : null;`

- [ ] **Step 4: Run tests + type-check**

Run: `pnpm exec vitest run src/lib/wp-runtime.test.ts`
Expected: PASS. The existing `wpAuthEnvKey` tests still pass.

Run: `TENANT_ID=limitemais pnpm exec astro check`
Expected: 0 errors (all call sites updated).

- [ ] **Step 5: Commit**

```bash
git add src/lib/wp-runtime.ts src/lib/wp-runtime.test.ts src/components/Header.astro src/components/Footer.astro src/layouts/BlogLayout.astro
git commit -m "feat(wp): explicit wpAuthEnv via wpAuthEnvKeyFor; thread resolved key through callers"
```

---

### Task 4: Overlay site name from BOLT on rendered surfaces

**Files:**
- Modify: `src/components/BaseHead.astro` (title / og:site_name / image alt; add `siteName` prop)
- Modify: `src/layouts/BlogLayout.astro:58` (pass `siteName` to BaseHead)
- Modify: `src/components/Header.astro` (aria-label) and `src/components/Footer.astro` (copyright)
- Test: covered by render verification in Task 5 (no isolated unit; these are `.astro` template wires).

**Interfaces:**
- Consumes: `BoltConfig.siteName` from `boltConfig(...)` (Task 3), `localeDisplay().siteName`.
- Produces: `BaseHead` accepts optional `siteName?: string`; when set it overrides `display.siteName` for `<title>`, `og:site_name`, and default image alt.

- [ ] **Step 1: Add `siteName` prop to BaseHead**

In `src/components/BaseHead.astro`, add `siteName` to the `Props` interface and destructure it (default `undefined`), then compute an effective name. Find the lines using `display.siteName` (≈54-66, 168) and route them through:

```ts
// near the other const declarations after `const display = localeDisplay(...)`
const effectiveSiteName = siteName || display.siteName;
const fullTitle = !title || title === effectiveSiteName
  ? effectiveSiteName
  : `${title} | ${effectiveSiteName}`;
const finalImageAlt = imageAlt ?? effectiveSiteName;
```

And change `<meta property="og:site_name" content={display.siteName} />` to `content={effectiveSiteName}`.

Guard the SEO `twitterHandle` / organization JSON-LD now that `seo` is optional — wrap the twitter metas:

```astro
{TENANT.seo?.twitterHandle && (
  <>
    <meta name="twitter:site" content={TENANT.seo.twitterHandle} />
    <meta name="twitter:creator" content={TENANT.seo.twitterHandle} />
  </>
)}
```

(If an organization JSON-LD block reads `TENANT.seo.organization`, guard it with `{TENANT.seo?.organization && ( ... )}`.)

- [ ] **Step 2: Pass BOLT siteName from BlogLayout**

In `src/layouts/BlogLayout.astro:58`, add the prop to the `<BaseHead .../>`:

```astro
<BaseHead locale={locale} vertical={vertical} analytics={false} themeColor={c.identity_color} faviconUrl={cfg?.branding.faviconUrl || undefined} siteName={cfg?.siteName || undefined} {...seoProps} />
```

- [ ] **Step 3: Overlay siteName in Header and Footer**

`src/components/Header.astro` — after `const cfg = ...` and `const display = ...`:

```ts
const siteName = cfg?.siteName || display.siteName;
```

Replace `display.siteName` usages in the brand `aria-label`/`alt` (≈lines 53-60) with `siteName`.

`src/components/Footer.astro` — add the BOLT fetch + overlay (it already imports `wpAuthEnvKeyFor` and has `authKey` from Task 3). Add the import `boltConfig` and:

```ts
import { footerData, boltConfig, wpAuthEnvKeyFor } from "../lib/wp-runtime";
// ...
const cfg = wpBaseUrl ? await boltConfig(wpBaseUrl, authKey) : null;
const siteName = cfg?.siteName || display.siteName;
```

Replace `display.siteName` in the copyright lines (≈60, 113) with `siteName`.

- [ ] **Step 4: Type-check**

Run: `TENANT_ID=limitemais pnpm exec astro check`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/BaseHead.astro src/layouts/BlogLayout.astro src/components/Header.astro src/components/Footer.astro
git commit -m "feat(seo): overlay site name from BOLT config on title/og/header/footer"
```

---

### Task 5: Wire cardfacil + full verification

**Files:**
- Modify: `src/lib/sites.config.ts` (add the `cardfacil` entry to `SITES`)
- Modify: `.dev.vars` (fix the auth secret casing)
- Modify: `wrangler.jsonc` (tidy the already-added cardfacil route; commit it)

**Interfaces:**
- Consumes: everything from Tasks 1-4.

- [ ] **Step 1: Add the minimal cardfacil entry**

In `src/lib/sites.config.ts`, add inside `SITES` (after the `limitemais` entry):

```ts
  "cardfacil": {
    "id": "cardfacil",
    "domains": ["cardfacil.com"],
    "defaultLocale": "pt-br",
    "locales": ["pt-br"],
    "wpAuthEnv": "WP_AUTH_CARDFACIL",
    "blog": { "wpBaseUrl": "https://cardfacil.com" }
  },
```

- [ ] **Step 2: Fix the dev auth secret name**

In `.dev.vars`, rename the cardfacil key so it matches `wpAuthEnv` exactly:

```
WP_AUTH_CARDFACIL=<the existing value currently under WP_AUTH_cardfacil>
```

(Remove the old lowercase `WP_AUTH_cardfacil` line.)

- [ ] **Step 3: Confirm the wrangler route**

`wrangler.jsonc` already has `{ "pattern": "astro-dev.cardfacil.com/*", "zone_name": "cardfacil.com" }`. Leave the dev route; do NOT add apex/www (prod is out of scope). The trailing comma/format should be valid JSONC.

- [ ] **Step 4: Full verification**

Run each and confirm:

```bash
pnpm exec vitest run
```
Expected: all tests PASS (109 prior + the new schema/tenant/wp-runtime tests).

```bash
TENANT_ID=limitemais pnpm exec astro check
```
Expected: 0 errors.

```bash
pnpm build
```
Expected: build succeeds.

Manual host check (routeless preview, per the project's run notes):
```bash
cp .dev.vars dist/server/.dev.vars
node -e "const fs=require('fs');const c=require('./dist/server/wrangler.json');delete c.routes;fs.writeFileSync('./dist/server/wrangler.local.json',JSON.stringify(c))"
pnpm exec wrangler dev -c dist/server/wrangler.local.json --port 8788
```
Then `curl -s -H 'Host: astro-dev.cardfacil.com' http://localhost:8788/ -o /dev/null -w '%{http_code}\n'` → expect `200` (a known WP-backed path), and an unknown host → `404`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sites.config.ts .dev.vars wrangler.jsonc
git commit -m "feat: connect cardfacil as a minimal bootstrap tenant"
```

---

## Self-Review

- **Spec coverage:** minimal entry (Task 5) ✓; `wpAuthEnv` exact name + resolver (Tasks 1, 3) ✓; `display`/`seo`/`legal` optional + `brand` default (Task 1) ✓; `DEFAULT_DISPLAY` + `localeDisplay` fallback (Task 2) ✓; siteName overlaid from BOLT (Task 4) ✓; `.dev.vars` casing fix + route confirm (Task 5) ✓; limitemais unchanged (regression tests in Tasks 1-3, astro check) ✓.
- **Out of scope honored:** no UI strings moved into WP; no prod KV/routes; no image pipeline.
- **Type consistency:** `wpAuthEnvKeyFor` / `wpDepsFromRuntime(baseUrl, authKey)` / `wpMenu|boltConfig|footerData(baseUrl, …, authKey)` consistent across Tasks 3-4 and call sites. `DEFAULT_DISPLAY: LocaleDisplay`, `DEFAULT_BRAND` matches the `brand` shape.
- **Note:** the Task 2 unit tests build the `Tenant` object directly (no schema parse), so `base.brand` is set to `DEFAULT_BRAND` explicitly rather than relying on the schema default.
