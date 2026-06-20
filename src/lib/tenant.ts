import { type Tenant, tenantSchema } from './schemas';

// ── SSR enablement: node-free render module ─────────────────────────────────────
// This module is reachable from the request path (blog SSR) AND the prerender
// path (quiz), both of which run in @astrojs/cloudflare's workerd sandbox where
// `node:fs` / `process.env` / `process.cwd()` are unavailable. So it MUST NOT
// import any node builtin or touch `process`. Build-time tenant data is baked
// into `import.meta.env` by astro.config.ts (vite.define) and parsed here.
//
// The node-only loaders (readFileSync of tenant.yaml, path resolution) live in
// `tenant.build.ts`, imported ONLY by astro.config.ts (which runs in Node).

export function activeTenantId(): string {
  const id = import.meta.env.TENANT_ID;
  if (!id) {
    throw new Error(
      'TENANT_ID was not baked into import.meta.env. Build with `TENANT_ID=<id> pnpm build` (astro.config bakes it via vite.define).',
    );
  }
  return id;
}

// T1.5.B18 — memoize on first property access via the Proxy below; the import
// stays free and the parse fires lazily at the first call site. Now sourced
// from the baked `import.meta.env.TENANT_JSON` rather than readFileSync.
let _tenantCache: Tenant | null = null;
export function getTenant(): Tenant {
  if (_tenantCache) return _tenantCache;
  const raw = import.meta.env.TENANT_JSON;
  if (!raw) {
    throw new Error(
      'TENANT_JSON was not baked into import.meta.env. astro.config.ts must define it via vite.define.',
    );
  }
  _tenantCache = tenantSchema.parse(JSON.parse(raw));
  return _tenantCache;
}

export const TENANT: Tenant = new Proxy({} as Tenant, {
  get(_, prop) {
    return getTenant()[prop as keyof Tenant];
  },
  has(_, prop) {
    return prop in getTenant();
  },
  ownKeys() {
    return Reflect.ownKeys(getTenant());
  },
  getOwnPropertyDescriptor(_, prop) {
    return Object.getOwnPropertyDescriptor(getTenant(), prop);
  },
});

export function localeDisplay(tenant: Tenant, locale: string) {
  const display = tenant.display[locale];
  if (display) return display;
  // T1.5.B18 — fall back to the tenant's defaultLocale instead of throwing.
  // Locale typos in routing (or stale links) shouldn't 500 the build; the
  // default locale is always present (Zod-guaranteed at tenant load).
  const fallback = tenant.display[tenant.defaultLocale];
  if (!fallback) {
    throw new Error(
      `Tenant "${tenant.id}" missing display config for defaultLocale "${tenant.defaultLocale}".`,
    );
  }
  console.warn(
    `localeDisplay fallback: tenant=${tenant.id} requested=${locale} → ${tenant.defaultLocale}`,
  );
  return fallback;
}

export function primaryDomain(tenant: Tenant): string {
  return tenant.domains[0];
}

export function siteOrigin(tenant: Tenant): string {
  return `https://${primaryDomain(tenant)}`;
}
