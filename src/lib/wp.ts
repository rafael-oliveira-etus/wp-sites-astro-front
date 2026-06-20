import type { WpAuthor, WpPost, WpTerm } from './wp-types';
import { normalizeWpAuthor, normalizeWpPost, normalizeWpTerm } from './wp-normalize';
import { cachedJson, type CacheStore } from './wp-cache';
import { buildMenuTree, parseMenuLocations, type WpMenuItem } from './wp-menu';

export interface WpDeps {
  baseUrl: string;
  fetch: typeof fetch;
  store: CacheStore;
  now: number;
  waitUntil?: (p: Promise<unknown>) => void;
  softTtlSec?: number;
  hardTtlSec?: number;
  /** Full `Authorization` header value (e.g. "Basic …") for auth-gated endpoints
   *  like menus. Server-side only — sourced from a Worker secret, never baked. */
  authHeader?: string;
}

export function buildWpUrl(
  baseUrl: string,
  path: string,
  query: Record<string, string | number | undefined> = {},
): string {
  const url = new URL(`/wp-json${path}`, baseUrl);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  return url.toString();
}

/**
 * Cached JSON GET. `opts.auth` attaches the WP_AUTH header — pass it ONLY for the
 * auth-gated endpoints (menus). Public content endpoints (posts/categories/pages/
 * tags) MUST stay anonymous: WordPress 401s an authenticated request when the
 * app-password is invalid/expired, even on public content, which would otherwise
 * turn a working post read into a 500.
 */
export async function fetchJson<T>(deps: WpDeps, url: string, opts: { auth?: boolean; headers?: Record<string, string> } = {}): Promise<T> {
  return cachedJson<T>({
    store: deps.store,
    key: url,
    softTtlSec: deps.softTtlSec ?? 600,
    hardTtlSec: deps.hardTtlSec ?? 86400,
    now: deps.now,
    waitUntil: deps.waitUntil,
    fetcher: async () => {
      const headers: Record<string, string> = { accept: 'application/json', ...(opts.headers ?? {}) };
      if (opts.auth && deps.authHeader) headers.authorization = deps.authHeader;
      const res = await deps.fetch(url, { headers });
      if (!res.ok) throw new Error(`WP ${res.status} for ${url}`);
      return (await res.json()) as T;
    },
  });
}

async function firstBySlug<T>(deps: WpDeps, path: string, slug: string, normalize: (raw: unknown) => T): Promise<T | null> {
  const url = buildWpUrl(deps.baseUrl, path, { slug, _embed: 1 });
  const arr = await fetchJson<unknown[]>(deps, url);
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return normalize(arr[0]);
}

export function getPostBySlug(deps: WpDeps, slug: string): Promise<WpPost | null> {
  return firstBySlug(deps, '/wp/v2/posts', slug, normalizeWpPost);
}
export function getPageBySlug(deps: WpDeps, slug: string): Promise<WpPost | null> {
  return firstBySlug(deps, '/wp/v2/pages', slug, normalizeWpPost);
}
export function getCategoryBySlug(deps: WpDeps, slug: string): Promise<WpTerm | null> {
  return firstBySlug(deps, '/wp/v2/categories', slug, normalizeWpTerm);
}
export function getAuthorBySlug(deps: WpDeps, slug: string): Promise<WpAuthor | null> {
  return firstBySlug(deps, '/wp/v2/users', slug, normalizeWpAuthor);
}

/**
 * Latest posts (newest first), optionally filtered by category id or tag id.
 * Returns the normalized list (first page). Cached by URL like every other call.
 */
export async function getPosts(
  deps: WpDeps,
  opts: { perPage?: number; categoryId?: number; tagId?: number } = {},
): Promise<WpPost[]> {
  const url = buildWpUrl(deps.baseUrl, '/wp/v2/posts', {
    _embed: 1,
    per_page: opts.perPage ?? 12,
    categories: opts.categoryId,
    tags: opts.tagId,
  });
  const arr = await fetchJson<unknown[]>(deps, url);
  if (!Array.isArray(arr)) return [];
  return arr.map(normalizeWpPost);
}

export interface PostsPage {
  posts: WpPost[];
  page: number;
  totalPages: number;
  total: number;
}

export async function getPostsPage(
  deps: WpDeps,
  opts: { page?: number; perPage?: number; categoryId?: number; tagId?: number } = {},
): Promise<PostsPage> {
  const page = Math.max(1, opts.page ?? 1);
  const url = buildWpUrl(deps.baseUrl, '/wp/v2/posts', {
    _embed: 1,
    per_page: opts.perPage ?? 12,
    page,
    categories: opts.categoryId,
    tags: opts.tagId,
  });
  try {
    const env = await cachedJson<{ raw: unknown[]; totalPages: number; total: number }>({
      store: deps.store, key: url,
      softTtlSec: deps.softTtlSec ?? 600, hardTtlSec: deps.hardTtlSec ?? 86400,
      now: deps.now, waitUntil: deps.waitUntil,
      fetcher: async () => {
        // Public content endpoint — no auth header (see fetchJson docs).
        const headers: Record<string, string> = { accept: 'application/json' };
        const res = await deps.fetch(url, { headers });
        if (!res.ok) throw new Error(`WP ${res.status} for ${url}`);
        const raw = (await res.json()) as unknown[];
        return {
          raw: Array.isArray(raw) ? raw : [],
          totalPages: Number(res.headers.get('x-wp-totalpages') ?? '1') || 1,
          total: Number(res.headers.get('x-wp-total') ?? '0') || 0,
        };
      },
    });
    return { posts: env.raw.map(normalizeWpPost), page, totalPages: env.totalPages, total: env.total };
  } catch {
    return { posts: [], page, totalPages: 0, total: 0 };
  }
}

export function getTagBySlug(deps: WpDeps, slug: string): Promise<WpTerm | null> {
  return firstBySlug(deps, '/wp/v2/tags', slug, normalizeWpTerm);
}

/**
 * Author archive resolved WITHOUT the `/wp/v2/users` endpoint (often 401 for
 * anonymous requests). Scans the latest posts and returns those by this author
 * slug, plus the author object lifted from the first match's embed.
 */
export async function getAuthorPosts(
  deps: WpDeps,
  slug: string,
  opts: { perPage?: number } = {},
): Promise<{ author: WpAuthor; posts: WpPost[] } | null> {
  const recent = await getPosts(deps, { perPage: opts.perPage ?? 100 });
  const mine = recent.filter((p) => p.author?.slug === slug);
  if (mine.length === 0 || !mine[0].author) return null;
  return { author: mine[0].author, posts: mine };
}

/** location → menu id (`/wp/v2/menu-locations`, auth-gated). */
export async function getMenuLocations(deps: WpDeps): Promise<Record<string, number>> {
  const url = buildWpUrl(deps.baseUrl, '/wp/v2/menu-locations');
  return parseMenuLocations(await fetchJson<unknown>(deps, url, { auth: true }));
}

/**
 * Nav menu for a theme location as an ordered tree. Resolves the location → menu
 * id → items (`/wp/v2/menu-items`, both auth-gated). Returns [] on any failure
 * (no auth, unknown location) so Header/Footer fall back gracefully.
 */
export async function getMenuTree(deps: WpDeps, location: string): Promise<WpMenuItem[]> {
  try {
    const locations = await getMenuLocations(deps);
    const menuId = locations[location];
    if (!menuId) return [];
    const url = buildWpUrl(deps.baseUrl, '/wp/v2/menu-items', { menus: menuId, per_page: 100 });
    const items = await fetchJson<unknown[]>(deps, url, { auth: true });
    return buildMenuTree(items, { wpBaseUrl: deps.baseUrl });
  } catch {
    return [];
  }
}

export async function getFooterMenus(deps: WpDeps): Promise<{ first: WpMenuItem[]; second: WpMenuItem[] }> {
  const [first, second] = await Promise.all([
    getMenuTree(deps, 'footer-first-menu'),
    getMenuTree(deps, 'footer-second-menu'),
  ]);
  return { first, second };
}
