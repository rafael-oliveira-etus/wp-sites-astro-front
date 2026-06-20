import { type Tenant, type Vertical } from './schemas';
import { siteOrigin } from './tenant';

export function localePath(locale: string): string {
  return `/${locale}`;
}

export function quizPath(locale: string, vertical: Vertical, slug: string): string {
  return `/${locale}/quiz/${vertical}/${slug}`;
}

export function quizStepPath(
  locale: string,
  vertical: Vertical,
  slug: string,
  step: string,
): string {
  return `/${locale}/quiz/${vertical}/${slug}/${step}`;
}

export function blogHubPath(locale: string): string {
  return `/${locale}/blog`;
}

export function verticalHubPath(locale: string, vertical: Vertical): string {
  return `/${locale}/blog/${vertical}`;
}

export function postPath(locale: string, vertical: Vertical, slug: string): string {
  return `/${locale}/blog/${vertical}/${slug}`;
}

/**
 * Normalize a root-relative path to the tenant's canonical trailing-slash policy.
 * Headless-WordPress tenants mirror WP's permalinks, which always end in `/`, so
 * we append one; quiz/YAML tenants keep their `trailingSlash:'never'` paths as-is.
 * Skips the bare root, query/hash paths, and file-like paths (a `.` in the last
 * segment, e.g. `/sitemap-index.xml`) so only real page paths get the slash.
 */
export function tenantPath(tenant: Tenant, path: string): string {
  if (!tenant.blog?.wpBaseUrl) return path;
  if (path === '/' || path.endsWith('/') || /[?#]/.test(path)) return path;
  const lastSeg = path.slice(path.lastIndexOf('/') + 1);
  if (lastSeg.includes('.')) return path;
  return `${path}/`;
}

export function absoluteUrl(tenant: Tenant, path: string): string {
  return `${siteOrigin(tenant)}${tenantPath(tenant, path)}`;
}

// T1.5.B16 — guard against lang-only locales ('en', 'pt') so we don't crash on
// region.toUpperCase(). The Facebook Open Graph spec also accepts the bare
// language form, so when the region is missing we duplicate the language as
// the region (e.g. 'pt' → 'pt_PT'). Properly-formed BCP-47 inputs are
// unaffected.
export function bcp47ToOgLocale(locale: string): string {
  const [lang, region] = locale.split('-');
  if (!region) return `${lang}_${lang.toUpperCase()}`;
  return `${lang}_${region.toUpperCase()}`;
}
