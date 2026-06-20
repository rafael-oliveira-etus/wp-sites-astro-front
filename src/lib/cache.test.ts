import { describe, expect, it } from 'vitest';
import {
  type EdgeCache,
  cacheKeyUrl,
  cacheTags,
  isFresh,
  isRequestCacheable,
  isResponseCacheable,
  parseCfDeviceType,
  serveWithCache,
} from './cache';

describe('parseCfDeviceType', () => {
  it('passes valid CF-Device-Type values, null otherwise', () => {
    expect(parseCfDeviceType('mobile')).toBe('mobile');
    expect(parseCfDeviceType('tablet')).toBe('tablet');
    expect(parseCfDeviceType('desktop')).toBe('desktop');
    expect(parseCfDeviceType('phone')).toBeNull();
    expect(parseCfDeviceType(null)).toBeNull();
    expect(parseCfDeviceType(undefined)).toBeNull();
  });
});

describe('cacheKeyUrl', () => {
  it('namespaces by device', () => {
    expect(cacheKeyUrl('https://x.com/p', 'mobile')).toContain('__etus_dev=mobile');
    expect(cacheKeyUrl('https://x.com/p', 'desktop')).not.toBe(cacheKeyUrl('https://x.com/p', 'mobile'));
  });
  it('is independent of query-param order', () => {
    expect(cacheKeyUrl('https://x.com/p?b=2&a=1', 'mobile')).toBe(cacheKeyUrl('https://x.com/p?a=1&b=2', 'mobile'));
  });
  it('strips tracking params so a blast does not fragment the cache', () => {
    expect(cacheKeyUrl('https://x.com/p?utm_source=news&fbclid=z&a=1', 'mobile')).toBe(
      cacheKeyUrl('https://x.com/p?a=1', 'mobile'),
    );
  });
  it('keeps content-bearing params (e.g. pagination)', () => {
    expect(cacheKeyUrl('https://x.com/p?page=2', 'mobile')).toContain('page=2');
  });
});

describe('isRequestCacheable', () => {
  it('only caches production GET requests that carry a CF-Device-Type', () => {
    expect(isRequestCacheable({ method: 'GET', isProduction: true, device: 'mobile' })).toBe(true);
    expect(isRequestCacheable({ method: 'GET', isProduction: false, device: 'mobile' })).toBe(false);
    expect(isRequestCacheable({ method: 'GET', isProduction: true, device: null })).toBe(false);
    expect(isRequestCacheable({ method: 'POST', isProduction: true, device: 'mobile' })).toBe(false);
  });
});

describe('isResponseCacheable', () => {
  const html = (init: ResponseInit) => new Response('<html></html>', init);
  it('caches 200 HTML with no Set-Cookie', () => {
    expect(isResponseCacheable(html({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }))).toBe(true);
  });
  it('refuses Set-Cookie (would leak a session id to everyone)', () => {
    expect(
      isResponseCacheable(html({ status: 200, headers: { 'content-type': 'text/html', 'set-cookie': 'sid=1' } })),
    ).toBe(false);
  });
  it('refuses non-200 and non-HTML', () => {
    expect(isResponseCacheable(html({ status: 404, headers: { 'content-type': 'text/html' } }))).toBe(false);
    expect(isResponseCacheable(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))).toBe(false);
  });
});

describe('isFresh', () => {
  it('fresh within the TTL, stale after, never for a missing stamp', () => {
    expect(isFresh(1000, 1000 + 59_000, 60)).toBe(true);
    expect(isFresh(1000, 1000 + 61_000, 60)).toBe(false);
    expect(isFresh(0, 5000, 60)).toBe(false);
    expect(isFresh(Number.NaN, 5000, 60)).toBe(false);
  });
});

describe('cacheTags', () => {
  it('emits a global, per-site and per-path tag', () => {
    expect(cacheTags('cards.example.com', '/posts/x')).toEqual(['etus-page', 'site:cards.example.com', 'path:/posts/x']);
  });
});

// ── orchestrator ──────────────────────────────────────────────────────────
class FakeCache implements EdgeCache {
  store = new Map<string, { body: string; status: number; headers: Headers }>();
  async match(key: Request): Promise<Response | undefined> {
    const e = this.store.get(key.url);
    return e ? new Response(e.body, { status: e.status, headers: new Headers(e.headers) }) : undefined;
  }
  async put(key: Request, res: Response): Promise<void> {
    this.store.set(key.url, { body: await res.text(), status: res.status, headers: new Headers(res.headers) });
  }
}

const htmlRender = () => {
  let n = 0;
  return {
    calls: () => n,
    render: async () => {
      n++;
      return new Response(`<html>v${n}</html>`, { status: 200, headers: { 'content-type': 'text/html' } });
    },
  };
};

const run = (cache: EdgeCache, now: number, render: () => Promise<Response>, pending: Promise<unknown>[]) =>
  serveWithCache({
    cache,
    key: new Request('https://x.com/p?__etus_dev=mobile'),
    ttlSec: 60,
    now,
    tags: ['etus-page'],
    waitUntil: (p) => pending.push(p),
    render,
  });

describe('serveWithCache', () => {
  it('MISS renders, stores, and serves; a later request is a fresh HIT (no re-render)', async () => {
    const cache = new FakeCache();
    const r = htmlRender();
    const pending: Promise<unknown>[] = [];

    const r1 = await run(cache, 1000, r.render, pending);
    expect(r1.headers.get('x-etus-cache')).toBe('MISS');
    await Promise.all(pending);
    expect(cache.store.size).toBe(1);

    const r2 = await run(cache, 5000, r.render, pending);
    expect(r2.headers.get('x-etus-cache')).toBe('HIT');
    expect(await r2.text()).toBe('<html>v1</html>');
    expect(r.calls()).toBe(1); // served from cache, render NOT called again
  });

  it('a stale entry re-renders and refreshes', async () => {
    const cache = new FakeCache();
    const r = htmlRender();
    const pending: Promise<unknown>[] = [];
    await run(cache, 1000, r.render, pending);
    await Promise.all(pending);

    const r3 = await run(cache, 1000 + 61_000, r.render, pending);
    expect(r3.headers.get('x-etus-cache')).toBe('STALE');
    expect(r.calls()).toBe(2);
  });

  it('does NOT store a non-cacheable (404 / Set-Cookie) response', async () => {
    const cache = new FakeCache();
    const pending: Promise<unknown>[] = [];
    const r = await run(cache, 1000, async () => new Response('x', { status: 404, headers: { 'content-type': 'text/html' } }), pending);
    expect(r.headers.get('x-etus-cache')).toBe('BYPASS');
    await Promise.all(pending);
    expect(cache.store.size).toBe(0);
  });

  it('fails OPEN when cache.match throws (still renders)', async () => {
    const throwing: EdgeCache = {
      match: async () => {
        throw new Error('boom');
      },
      put: async () => {},
    };
    const r = htmlRender();
    const res = await run(throwing, 1000, r.render, []);
    expect(res.headers.get('x-etus-cache')).toBe('MISS');
    expect(r.calls()).toBe(1);
  });

  it('preserves a render-set header (the CSP nonce) verbatim across store→HIT', async () => {
    // The nonce-cache coupling: middleware bakes ONE nonce into both the CSP header
    // and the body. The HIT must serve the STORED header (matching the stored body),
    // never a fresh per-request nonce over stale body — else strict CSP blocks ads.
    const cache = new FakeCache();
    const pending: Promise<unknown>[] = [];
    const render = async () =>
      new Response('<html>nonce-N1</html>', {
        status: 200,
        headers: { 'content-type': 'text/html', 'content-security-policy-report-only': "script-src 'nonce-N1'" },
      });

    const miss = await run(cache, 1000, render, pending);
    expect(miss.headers.get('content-security-policy-report-only')).toBe("script-src 'nonce-N1'");
    await Promise.all(pending);

    const hit = await run(cache, 5000, render, pending);
    expect(hit.headers.get('x-etus-cache')).toBe('HIT');
    expect(hit.headers.get('content-security-policy-report-only')).toBe("script-src 'nonce-N1'");
    expect(await hit.text()).toBe('<html>nonce-N1</html>'); // header nonce still matches body nonce
  });
});
