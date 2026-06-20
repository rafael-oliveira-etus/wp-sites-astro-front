import { kvCacheStore, type CacheStore, type KvLike } from './wp-cache';
import { getMenuTree, getFooterMenus, type WpDeps } from './wp';
import type { WpMenuItem } from './wp-menu';
import { getBoltConfig } from './wp-config';
import type { BoltConfig } from './wp-config';
import { getFooterWidgets, type FooterWidgets } from './wp-footer';

/**
 * Build WpDeps from the Worker runtime. Astro v6 removed `Astro.locals.runtime.env`,
 * so bindings are read via the `cloudflare:workers` module (as middleware does).
 * The import is absent under `astro dev` → falls back to the in-memory store.
 */
export async function wpDepsFromRuntime(baseUrl: string): Promise<WpDeps> {
  let kv: KvLike | null = null;
  let secret: string | undefined;
  try {
    const mod = await import('cloudflare:workers');
    const env = (mod as unknown as { env?: Record<string, unknown> }).env ?? {};
    kv = (env.WP_CACHE as KvLike | undefined) ?? null;
    secret = env.WP_AUTH as string | undefined;
  } catch {
    kv = null;
  }
  // Dev/build fallback (no cloudflare:workers): allow WP_AUTH via process.env.
  if (!secret && typeof process !== 'undefined') secret = process.env?.WP_AUTH;
  // WP_AUTH holds "user:application_password"; encode it as an HTTP Basic header.
  const authHeader = secret ? `Basic ${btoa(secret)}` : undefined;
  return wpDeps({ baseUrl, kv, authHeader });
}

/**
 * Resolve a WP nav menu for the header/footer, trying each candidate theme-location
 * slug until one returns items. Returns [] on any failure (no auth, none match) so
 * the caller falls back to its default navigation. Safe to call from a component.
 */
export async function wpMenu(baseUrl: string, candidates: Array<string | undefined>): Promise<WpMenuItem[]> {
  const locs = candidates.filter((c): c is string => Boolean(c));
  if (locs.length === 0) return [];
  const deps = await wpDepsFromRuntime(baseUrl);
  for (const loc of locs) {
    const tree = await getMenuTree(deps, loc);
    if (tree.length > 0) return tree;
  }
  return [];
}

/** Fetch the BOLT site config (colors/branding) for a headless tenant. Cached;
 *  null on failure so callers fall back to neutral defaults. */
export async function boltConfig(baseUrl: string): Promise<BoltConfig | null> {
  const deps = await wpDepsFromRuntime(baseUrl);
  return getBoltConfig(deps);
}

export async function footerData(baseUrl: string): Promise<{ widgets: FooterWidgets; first: WpMenuItem[]; second: WpMenuItem[] }> {
  const deps = await wpDepsFromRuntime(baseUrl);
  const [widgets, menus] = await Promise.all([getFooterWidgets(deps), getFooterMenus(deps)]);
  return { widgets, first: menus.first, second: menus.second };
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
