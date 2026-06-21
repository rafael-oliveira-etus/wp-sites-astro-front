import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import { SITES } from './src/lib/sites.config';

// Dev-only: let the Vite dev server accept requests for the configured site
// domains + their subdomains (e.g. astro-dev.limitemais.com → localhost) so the
// real Host-based tenant resolution can be exercised locally. A leading-dot entry
// allows the domain and all its subdomains.
const allowedHosts = [
  ...new Set(Object.values(SITES).flatMap((s) => s.domains.flatMap((d) => [d, `.${d}`]))),
];

// Generic multi-tenant build: NO tenant is baked here. The active tenant is
// resolved per-request from the Host (src/lib/sites.config.ts + middleware.ts)
// and read via `Astro.locals.tenant`. One build serves every site.
//
// Consequences of going generic:
//  - `site` is dropped — absolute URLs come from `siteOrigin(tenant)` at runtime.
//  - `@astrojs/sitemap` (build-time, single-origin) is gone — the sitemap is
//    served by each tenant's WordPress origin (see BaseHead `<link rel=sitemap>`).
//  - `i18n` routing is dropped — headless tenants use flat permalinks and the
//    locale comes from `tenant.defaultLocale`, not Astro's locale router.
//  - `publicDir` is the single shared `./public` (only `_headers`/`_redirects`).

export default defineConfig({
  output: 'server',
  adapter: cloudflare({ imageService: 'passthrough' }),
  // Bind the dev server to 0.0.0.0 (all interfaces, incl. IPv4 127.0.0.1) instead of
  // only IPv6 ::1. The dev hostnames (astro-dev.<tenant>.com) are mapped to 127.0.0.1
  // in /etc/hosts, and Astro's default `localhost` bind lands on ::1-only on
  // macOS+Node, so IPv4 connections get refused. Astro's top-level `server.host`
  // overrides vite.server.host, so it MUST live here, not under `vite`.
  server: { host: true },
  // Headless-WordPress permalinks: canonical form ends in `/`, but `'ignore'`
  // serves BOTH `/foo` and `/foo/` as 200 so no inbound link 404s.
  trailingSlash: 'ignore',
  publicDir: './public',
  vite: {
    server: { allowedHosts },
    ssr: {
      // Workspace packages ship raw .astro/.ts source — Astro must bundle them
      // for SSR rather than treat them as external node modules.
      noExternal: ['@etus/ads', '@etus/seo'],
    },
  },
  build: {
    // Inline all stylesheets: per-page critical-CSS budget is small (<10 KB) and
    // inlining eliminates the render-blocking chain at the cost of a few KB HTML.
    inlineStylesheets: 'always',
    format: 'directory',
  },
  // Prefetch runtime disabled — marginal benefit for the JS cost.
  prefetch: false,
  compressHTML: true,
});
