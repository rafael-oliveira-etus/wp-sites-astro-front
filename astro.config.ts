import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import cloudflare from '@astrojs/cloudflare';

import { siteOrigin } from './src/lib/tenant';
import {
  activeTenantIdFromEnv,
  loadTenant,
  tenantContentDir,
  tenantPublicDir,
} from './src/lib/tenant.build';

// Payload L1: the analytics tracking engine is no longer baked into an inline
// `import.meta.env.MINIFIED_BOOT` string. It now ships as a real bundled module
// (`src/lib/analytics-boot-engine.ts`), which Astro hashes + caches like
// ClientRouter/WebVitals. Only the tiny per-page cfg + a synchronous stub stay
// inline (see AnalyticsBoot.astro). The former esbuild minify-and-bake step
// (and its `transformSync` import) are gone with it.

// ── SSR enablement ─────────────────────────────────────────────────
// The @astrojs/cloudflare v13 adapter prerenders quiz routes in a workerd
// sandbox where node:fs / process.env are unavailable. Bake the build-time
// tenant data here (astro.config runs in Node → safe) and read it from
// import.meta.env at render so neither the request path (blog SSR) nor the
// prerender path (quiz) ever touches a node API.
//
// NOTE: this module reads `process.env.TENANT_ID` + `loadTenant` (Node) — it
// must NOT use the `import.meta.env`-backed `activeTenantId()` from tenant.ts,
// because vite.define rewrites the APP bundle, not this config module.
const TENANT_ID = activeTenantIdFromEnv();
const TENANT_OBJ = loadTenant(TENANT_ID);
const TENANT_JSON = JSON.stringify(TENANT_OBJ);
const TENANT_CONTENT_DIR = tenantContentDir(TENANT_ID);
const TENANT_LOGO_SVG = (() => {
  const logo = TENANT_OBJ.brand.logo;
  if (!logo.src.endsWith('.svg')) return '';
  try {
    return readFileSync(join(tenantPublicDir(TENANT_ID), logo.src), 'utf8')
      .replace(/<\?xml[^?]*\?>\s*/i, '')
      .replace(/<!DOCTYPE[^>]*>\s*/i, '')
      .replace(/<title[^>]*>[\s\S]*?<\/title>/gi, '')
      .replace(/<svg([^>]*)>/i, (_m, attrs) => {
        const cleaned = attrs
          .replace(/\swidth="[^"]*"/i, '')
          .replace(/\sheight="[^"]*"/i, '');
        return `<svg${cleaned} width="${logo.width}" height="${logo.height}" class="brand-logo">`;
      });
  } catch {
    return '';
  }
})();

// T1.5.B7 — SW VERSION must change every deploy to invalidate stale asset
// caches. Prefer the CI commit SHA; fall back to build timestamp so local
// builds also get a fresh ID. Exposed to client code via `import.meta.env`.
const BUILD_ID =
  (process.env.GITHUB_SHA && process.env.GITHUB_SHA.slice(0, 12)) ||
  (process.env.CF_PAGES_COMMIT_SHA && process.env.CF_PAGES_COMMIT_SHA.slice(0, 12)) ||
  String(Date.now());

export default defineConfig({
  site: siteOrigin(TENANT_OBJ),
  // SSR enablement: blog routes render per-request; quiz/index/404/sw opt into
  // prerender via `export const prerender = true`.
  output: 'server',
  adapter: cloudflare({ imageService: 'passthrough' }),
  // Headless-WordPress tenants mirror WP's permalinks (canonical form ends in `/`),
  // but stay tolerant: `'ignore'` serves BOTH `/foo` and `/foo/` as 200 so no
  // inbound link 404s. We still EMIT the slashed form everywhere (links, sitemap)
  // and point `<link rel=canonical>` at it, so the slashed URL is the SEO canonical
  // and the unslashed one dedupes to it. Quiz/YAML tenants keep `'never'`.
  trailingSlash: TENANT_OBJ.blog?.wpBaseUrl ? 'ignore' : 'never',
  publicDir: `./tenants/${TENANT_ID}/public`,
  vite: {
    define: {
      'import.meta.env.PUBLIC_BUILD_ID': JSON.stringify(BUILD_ID),
      'import.meta.env.TENANT_ID': JSON.stringify(TENANT_ID),
      'import.meta.env.TENANT_JSON': JSON.stringify(TENANT_JSON),
      'import.meta.env.TENANT_LOGO_SVG': JSON.stringify(TENANT_LOGO_SVG),
      'import.meta.env.TENANT_CONTENT_DIR': JSON.stringify(TENANT_CONTENT_DIR),
    },
    ssr: {
      // Workspace packages ship raw .astro/.ts source — Astro must bundle them
      // for SSR rather than treat them as external node modules.
      noExternal: ['@etus/ads', '@etus/seo'],
    },
  },
  i18n: {
    defaultLocale: TENANT_OBJ.defaultLocale,
    locales: [...TENANT_OBJ.locales],
    routing: {
      // Headless-WordPress tenants mirror WP's flat permalinks (`/{slug}`), so the
      // default locale is NOT prefixed. Quiz/YAML tenants keep `/{locale}/…`.
      prefixDefaultLocale: !TENANT_OBJ.blog?.wpBaseUrl,
      // Our `src/pages/index.astro` handles the `/` → `/{defaultLocale}` redirect.
      // Leaving this `true` makes Astro auto-generate a competing `/` route.
      redirectToDefaultLocale: false,
    },
  },
  build: {
    // Lighthouse "Render-blocking requests" was flagging `_astro/index@_@*.css`
    // (1.6 KiB) + `_astro/Footer.*.css` (2.4 KiB) — `'auto'` left them external
    // for these pages despite both being well under the 4 KB threshold. SSG
    // critical-CSS budget per page is small (<10 KB total), so inlining all
    // sheets eliminates the render-blocking chain at the cost of a few extra
    // KB of HTML (offset by the saved RTTs on cold connections).
    inlineStylesheets: 'always',
    format: 'directory',
  },
  // Astro prefetch runtime disabled — adds 5KB JS for marginal benefit.
  // Multi-page quiz uses native `<link rel="prefetch">` instead (zero JS).
  prefetch: false,
  compressHTML: true,
  // T1.8 — vite/esbuild target pin REMOVED. Astro 6 emits ES2022 features
  // (complex destructuring, etc) that esbuild cannot down-level to any
  // lower target without Babel + core-js — out of scope today.
  // Effective compat floor: ES2022 (iOS Safari 16+, Chrome 94+, Firefox 93+).
  // iOS Safari 14-15 (~3-5% LATAM finance traffic, declining) will syntax-error.
  // Mitigated where it matters by CSS fallbacks (T1.9) for layout.
  // If we need pre-iOS-16 support: add @vitejs/plugin-legacy + Babel pipeline
  // (significant infra change, deferred).
  integrations: [
    sitemap({
      changefreq: 'weekly',
      priority: 0.7,
      filter: (page) => !/\/quiz\/[^/]+\/[^/]+\/(?!$)/.test(page),
      // T1.5.H17 — pass the i18n locale map so @astrojs/sitemap emits
      // `<xhtml:link rel="alternate" hreflang="…">` per URL. Our routes use
      // BCP-47 lowercase (`/en-us/...`) but the hreflang value should be the
      // canonical case-correct form (`en-US`).
      i18n: {
        defaultLocale: TENANT_OBJ.defaultLocale,
        locales: Object.fromEntries(
          TENANT_OBJ.locales.map((l) => {
            const [lang, region] = l.split('-');
            return [l, region ? `${lang}-${region.toUpperCase()}` : lang];
          }),
        ),
      },
    }),
  ],
});
