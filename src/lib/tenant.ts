import { type Tenant } from './schemas';

// ── Tenant helpers (node-free, param-based) ─────────────────────────────────────
// The active tenant is resolved per-request from the Host (see sites.config.ts +
// middleware.ts) and read via `Astro.locals.tenant`. These helpers take a tenant
// as a parameter so they work the same on the request path and in pure unit tests.
// No node builtins / no `process` — safe in the workerd render sandbox.

export function localeDisplay(tenant: Tenant, locale: string) {
  const display = tenant.display?.[locale];
  if (display) return display;
  // Locale typos in routing (or stale links) shouldn't 500; the default locale is
  // always present (Zod-guaranteed at tenant load).
  const fallback = tenant.display?.[tenant.defaultLocale];
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
