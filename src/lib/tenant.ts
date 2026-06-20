import { type Tenant } from './schemas';
import { DEFAULT_DISPLAY } from './default-display';

// ── Tenant helpers (node-free, param-based) ─────────────────────────────────────
// The active tenant is resolved per-request from the Host (see sites.config.ts +
// middleware.ts) and read via `Astro.locals.tenant`. These helpers take a tenant
// as a parameter so they work the same on the request path and in pure unit tests.
// No node builtins / no `process` — safe in the workerd render sandbox.

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

export function primaryDomain(tenant: Tenant): string {
  return tenant.domains[0];
}

export function siteOrigin(tenant: Tenant): string {
  return `https://${primaryDomain(tenant)}`;
}
