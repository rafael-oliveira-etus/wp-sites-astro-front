import { describe, expect, it, vi } from 'vitest';
import postFixture from './__fixtures__/wp-post.json';
import { buildWpUrl, getPostBySlug, getCategoryBySlug, getPosts, getPostsPage, getTagBySlug, getMenuLocations, type WpDeps } from './wp';
import type { CacheStore } from './wp-cache';

function memStore(): CacheStore { const d: Record<string, string> = {}; return { async get(k){return d[k]??null;}, async put(k,v){d[k]=v;} }; }
function jsonResponse(body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', ...headers } });
}

describe('buildWpUrl', () => {
  it('builds a wp/v2 url with _embed and query', () => {
    const u = buildWpUrl('https://limitemais.com', '/wp/v2/posts', { slug: 'abc', _embed: 1 });
    expect(u).toBe('https://limitemais.com/wp-json/wp/v2/posts?slug=abc&_embed=1');
  });
  it('drops undefined query values', () => {
    const u = buildWpUrl('https://limitemais.com', '/wp/v2/posts', { slug: 'abc', page: undefined });
    expect(u).toBe('https://limitemais.com/wp-json/wp/v2/posts?slug=abc');
  });
});

describe('getPostBySlug', () => {
  const base: Omit<WpDeps, 'fetch'> = { baseUrl: 'https://limitemais.com', store: memStore(), now: 1_000_000 };

  it('returns the normalized post for a known slug', async () => {
    const fetch = vi.fn(async () => jsonResponse([postFixture]));
    const post = await getPostBySlug({ ...base, fetch: fetch as unknown as typeof globalThis.fetch }, 'any-slug');
    expect(post?.slug).toBe((postFixture as any).slug);
    expect(post?.publishedAt).toBeInstanceOf(Date);
    expect(fetch).toHaveBeenCalledTimes(1);
    const calls = fetch.mock.calls as unknown[][];
    const calledUrl = (calls[0]?.[0] as unknown) as string;
    expect(calledUrl).toContain('/wp-json/wp/v2/posts?slug=any-slug');
    expect(calledUrl).toContain('_embed=1');
  });

  it('returns null for an unknown slug (empty array)', async () => {
    const fetch = vi.fn(async () => jsonResponse([]));
    const post = await getPostBySlug({ ...base, store: memStore(), fetch: fetch as unknown as typeof globalThis.fetch }, 'nope');
    expect(post).toBeNull();
  });

  it('caches by URL: second call with same slug does not refetch', async () => {
    const store = memStore();
    const fetch = vi.fn(async () => jsonResponse([postFixture]));
    const deps = { ...base, store, fetch: fetch as unknown as typeof globalThis.fetch };
    await getPostBySlug(deps, 'cached-slug');
    await getPostBySlug(deps, 'cached-slug');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('getCategoryBySlug', () => {
  it('hits the categories endpoint and returns the term', async () => {
    const fetch = vi.fn(async () => jsonResponse([{ id: 37, slug: 'emprestimo', name: 'Empréstimo', taxonomy: 'category', link: 'https://limitemais.com/emprestimo/' }]));
    const term = await getCategoryBySlug({ baseUrl: 'https://limitemais.com', store: memStore(), now: 1, fetch: fetch as unknown as typeof globalThis.fetch }, 'emprestimo');
    expect(term?.slug).toBe('emprestimo');
    const calls = fetch.mock.calls as unknown[][];
    expect((calls[0]?.[0] as unknown) as string).toContain('/wp-json/wp/v2/categories?slug=emprestimo');
  });
});

describe('getPosts', () => {
  const base: Omit<WpDeps, 'fetch'> = { baseUrl: 'https://limitemais.com', store: memStore(), now: 1_000_000 };

  it('returns a normalized list with _embed and per_page', async () => {
    const fetch = vi.fn(async () => jsonResponse([postFixture, postFixture]));
    const posts = await getPosts({ ...base, fetch: fetch as unknown as typeof globalThis.fetch }, { perPage: 5 });
    expect(posts).toHaveLength(2);
    expect(posts[0].slug).toBe((postFixture as { slug: string }).slug);
    expect(posts[0].publishedAt).toBeInstanceOf(Date);
    const url = (fetch.mock.calls as unknown[][])[0][0] as string;
    expect(url).toContain('/wp-json/wp/v2/posts?');
    expect(url).toContain('_embed=1');
    expect(url).toContain('per_page=5');
  });

  it('adds the categories filter when a categoryId is given', async () => {
    const fetch = vi.fn(async () => jsonResponse([postFixture]));
    await getPosts({ ...base, store: memStore(), fetch: fetch as unknown as typeof globalThis.fetch }, { categoryId: 37 });
    const url = (fetch.mock.calls as unknown[][])[0][0] as string;
    expect(url).toContain('categories=37');
  });

  it('returns [] when the response is not an array', async () => {
    const fetch = vi.fn(async () => jsonResponse({ code: 'rest_error' }));
    const posts = await getPosts({ ...base, store: memStore(), fetch: fetch as unknown as typeof globalThis.fetch }, {});
    expect(posts).toEqual([]);
  });
});

describe('getPostsPage', () => {
  const base = { baseUrl: 'https://limitemais.com', store: memStore(), now: 1 };
  it('returns posts + totals read from headers, and sends page/per_page', async () => {
    const fetch = vi.fn(async () => jsonResponse([postFixture, postFixture], { 'x-wp-totalpages': '38', 'x-wp-total': '450' }));
    const r = await getPostsPage({ ...base, fetch: fetch as any }, { page: 2, perPage: 12 });
    expect(r.posts).toHaveLength(2);
    expect(r.totalPages).toBe(38);
    expect(r.total).toBe(450);
    expect(r.page).toBe(2);
    const url = (fetch.mock.calls as any[][])[0][0] as string;
    expect(url).toContain('per_page=12');
    expect(url).toContain('page=2');
  });
  it('adds tags filter when tagId given', async () => {
    const fetch = vi.fn(async () => jsonResponse([postFixture], { 'x-wp-totalpages': '1' }));
    await getPostsPage({ ...base, store: memStore(), fetch: fetch as any }, { tagId: 25 });
    expect(((fetch.mock.calls as any[][])[0][0] as string)).toContain('tags=25');
  });
  it('resolves to an empty page when WP 400s past the last page', async () => {
    const fetch = vi.fn(async () => new Response('{"code":"rest_post_invalid_page_number"}', { status: 400 }));
    const r = await getPostsPage({ ...base, store: memStore(), fetch: fetch as any }, { page: 99 });
    expect(r.posts).toEqual([]);
    expect(r.totalPages).toBe(0);
  });
});

describe('getTagBySlug', () => {
  it('hits /wp/v2/tags and returns the term', async () => {
    const fetch = vi.fn(async () => jsonResponse([{ id: 25, slug: 'iptu', name: 'IPTU', taxonomy: 'post_tag', link: '' }]));
    const t = await getTagBySlug({ baseUrl: 'https://limitemais.com', store: memStore(), now: 1, fetch: fetch as any }, 'iptu');
    expect(t?.slug).toBe('iptu');
    expect(((fetch.mock.calls as any[][])[0][0] as string)).toContain('/wp-json/wp/v2/tags?slug=iptu');
  });
});

describe('auth header scoping (a bad WP_AUTH must NOT break public reads)', () => {
  const authHeader = 'Basic dXNlcjpwdw==';
  const base = { baseUrl: 'https://limitemais.com', now: 1, authHeader };
  const initOf = (fetch: ReturnType<typeof vi.fn>) =>
    ((fetch.mock.calls as any[][])[0][1] ?? {}) as { headers?: Record<string, string> };

  it('does NOT send Authorization on a public post read (getPostBySlug)', async () => {
    const fetch = vi.fn(async () => jsonResponse([postFixture]));
    await getPostBySlug({ ...base, store: memStore(), fetch: fetch as any }, 'slug');
    expect(initOf(fetch).headers?.authorization).toBeUndefined();
  });

  it('does NOT send Authorization on the listing feed (getPostsPage)', async () => {
    const fetch = vi.fn(async () => jsonResponse([postFixture], { 'x-wp-totalpages': '1' }));
    await getPostsPage({ ...base, store: memStore(), fetch: fetch as any }, { page: 1 });
    expect(initOf(fetch).headers?.authorization).toBeUndefined();
  });

  it('DOES send Authorization on the auth-gated menu endpoint (getMenuLocations)', async () => {
    const fetch = vi.fn(async () => jsonResponse({}));
    await getMenuLocations({ ...base, store: memStore(), fetch: fetch as any });
    expect(initOf(fetch).headers?.authorization).toBe(authHeader);
  });

  it('a bad/expired WP_AUTH must NOT 401 a public post read (regression for the 500-on-post bug)', async () => {
    // Models real WordPress: an authenticated request with an invalid app-password
    // gets 401 even on public content; an anonymous request gets 200.
    const fetch = vi.fn(async (_url: string, init?: { headers?: Record<string, string> }) =>
      init?.headers?.authorization
        ? new Response('{"code":"incorrect_password","data":{"status":401}}', { status: 401 })
        : jsonResponse([postFixture]),
    );
    const post = await getPostBySlug({ ...base, store: memStore(), authHeader: 'Basic invalid', fetch: fetch as any }, 'slug');
    expect(post?.slug).toBe((postFixture as { slug: string }).slug); // resolved, not a 401/throw
  });
});
