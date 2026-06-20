import { kvCacheStore, type CacheStore, type KvLike } from './wp-cache';
import { getMenuTree, getFooterMenus, getPostsPageId, type WpDeps } from './wp';
import { dropMenuItemsByObjectId, type WpMenuItem } from './wp-menu';
import { getBoltConfig } from './wp-config';
import type { BoltConfig } from './wp-config';
import { getFooterWidgets, type FooterWidgets } from './wp-footer';

/** Per-tenant WP auth secret name: `WP_AUTH_<ID>` (id uppercased, non-alnum→`_`). */
export function wpAuthEnvKey(tenantId: string): string {
  return 'WP_AUTH_' + tenantId.toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

/** Resolve the WP auth env var name for a tenant: explicit `wpAuthEnv` wins,
 *  else the derived `WP_AUTH_<ID>` (back-compat). */
export function wpAuthEnvKeyFor(tenant: { id: string; wpAuthEnv?: string }): string {
  return tenant.wpAuthEnv ?? wpAuthEnvKey(tenant.id);
}

/**
 * Extract the Worker `waitUntil` from Astro.locals (the Cloudflare adapter exposes
 * the execution context as `locals.cfContext`). The WP cache serves stale and
 * revalidates out of band — but without `waitUntil` that revalidation is a
 * fire-and-forget promise the runtime cancels once the response is sent, so the
 * cache never refreshes (serves stale until the 24h hard TTL). Pass this into the
 * WP fetch helpers so stale entries actually revalidate. Returns it bound to its
 * ctx (the runtime's waitUntil throws if invoked detached), or undefined when
 * absent (e.g. `astro dev`'s node server).
 */
export function waitUntilFrom(locals: unknown): ((p: Promise<unknown>) => void) | undefined {
  try {
    const ctx = (locals as { cfContext?: { waitUntil?: (p: Promise<unknown>) => void } }).cfContext;
    return ctx?.waitUntil ? ctx.waitUntil.bind(ctx) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Build WpDeps from the Worker runtime. Astro v6 removed `Astro.locals.runtime.env`,
 * so bindings are read via the `cloudflare:workers` module (as middleware does).
 * The import is absent under `astro dev` → falls back to the in-memory store.
 * Auth is per-tenant: pass the resolved env key (from `wpAuthEnvKeyFor`).
 */
export async function wpDepsFromRuntime(baseUrl: string, authKey: string, waitUntil?: (p: Promise<unknown>) => void): Promise<WpDeps> {
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
  // Dev/build fallback (no cloudflare:workers): allow the secret via process.env.
  if (!secret && typeof process !== 'undefined') secret = process.env?.[authKey];
  // The secret holds "user:application_password"; encode it as an HTTP Basic header.
  const authHeader = secret ? `Basic ${btoa(secret)}` : undefined;
  return wpDeps({ baseUrl, kv, authHeader, waitUntil });
}

/**
 * Resolve a WP nav menu for the header/footer, trying each candidate theme-location
 * slug until one returns items. Returns [] on any failure (no auth, none match) so
 * the caller falls back to its default navigation. Safe to call from a component.
 */
export async function wpMenu(baseUrl: string, candidates: Array<string | undefined>, authKey: string, waitUntil?: (p: Promise<unknown>) => void): Promise<WpMenuItem[]> {
  const locs = candidates.filter((c): c is string => Boolean(c));
  if (locs.length === 0) return [];
  const deps = await wpDepsFromRuntime(baseUrl, authKey, waitUntil);
  // The posts-page ("Blog") link is dropped — the front renders the feed at `/`.
  const postsPageId = await getPostsPageId(deps);
  for (const loc of locs) {
    const tree = await getMenuTree(deps, loc);
    if (tree.length > 0) return dropMenuItemsByObjectId(tree, postsPageId);
  }
  return [];
}

/** Fetch the BOLT site config (colors/branding) for a headless tenant. Cached;
 *  null on failure so callers fall back to neutral defaults. */
export async function boltConfig(baseUrl: string, authKey: string, waitUntil?: (p: Promise<unknown>) => void): Promise<BoltConfig | null> {
  const deps = await wpDepsFromRuntime(baseUrl, authKey, waitUntil);
  return getBoltConfig(deps);
}

export async function footerData(baseUrl: string, authKey: string, waitUntil?: (p: Promise<unknown>) => void): Promise<{ widgets: FooterWidgets; first: WpMenuItem[]; second: WpMenuItem[] }> {
  const deps = await wpDepsFromRuntime(baseUrl, authKey, waitUntil);
  const [widgets, menus, postsPageId] = await Promise.all([getFooterWidgets(deps), getFooterMenus(deps), getPostsPageId(deps)]);
  return {
    widgets,
    first: dropMenuItemsByObjectId(menus.first, postsPageId),
    second: dropMenuItemsByObjectId(menus.second, postsPageId),
  };
}

// Best-effort in-memory cache for environments without a KV binding (astro dev,
// or a Worker without WP_CACHE bound). Persists for the life of the isolate; it
// is a cache, not a source of truth, so a cold isolate just refetches.
const memStore: CacheStore = (() => {
  const m = new Map<string, string>();
  return {
    async get(k) {
      return m.get(k) ?? null;
    },
    async put(k, v) {
      m.set(k, v);
    },
  };
})();

/**
 * Assemble the dependency bundle the WP client needs from per-request runtime
 * pieces. Uses the KV binding when present (production Worker) and falls back to
 * the in-memory store otherwise (dev). `baseUrl` comes from the tenant config.
 */
export function wpDeps(opts: {
  baseUrl: string;
  kv?: KvLike | null;
  waitUntil?: (p: Promise<unknown>) => void;
  authHeader?: string;
}): WpDeps {
  return {
    baseUrl: opts.baseUrl,
    // Bind to globalThis: the native fetch throws "Illegal invocation" when called
    // as a method off another object (deps.fetch(...)).
    fetch: globalThis.fetch.bind(globalThis),
    store: opts.kv ? kvCacheStore(opts.kv) : memStore,
    now: Date.now(),
    waitUntil: opts.waitUntil,
    authHeader: opts.authHeader,
  };
}
