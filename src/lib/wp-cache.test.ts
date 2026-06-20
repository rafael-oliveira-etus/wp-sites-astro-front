import { describe, expect, it, vi } from 'vitest';
import { cachedJson, kvCacheStore, type CacheStore } from './wp-cache';

function memStore(seed: Record<string, string> = {}): CacheStore & { _data: Record<string, string> } {
  const _data = { ...seed };
  return { _data, async get(k) { return _data[k] ?? null; }, async put(k, v) { _data[k] = v; } };
}
const SOFT = 600, HARD = 86400;

describe('cachedJson', () => {
  it('fetches and stores on a miss', async () => {
    const store = memStore();
    const fetcher = vi.fn(async () => ({ v: 1 }));
    const out = await cachedJson({ store, key: 'k', softTtlSec: SOFT, hardTtlSec: HARD, now: 1_000_000, fetcher });
    expect(out).toEqual({ v: 1 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(store._data['k']).toContain('"cachedAt"');
  });

  it('returns fresh cache without fetching', async () => {
    const now = 1_000_000;
    const store = memStore({ k: JSON.stringify({ data: { v: 9 }, cachedAt: now }) });
    const fetcher = vi.fn(async () => ({ v: 1 }));
    const out = await cachedJson({ store, key: 'k', softTtlSec: SOFT, hardTtlSec: HARD, now: now + 1000, fetcher });
    expect(out).toEqual({ v: 9 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('serves stale and revalidates in background via waitUntil', async () => {
    const old = 1_000_000;
    const store = memStore({ k: JSON.stringify({ data: { v: 9 }, cachedAt: old }) });
    const fetcher = vi.fn(async () => ({ v: 2 }));
    const tasks: Promise<unknown>[] = [];
    const out = await cachedJson({
      store, key: 'k', softTtlSec: SOFT, hardTtlSec: HARD,
      now: old + SOFT * 1000 + 1, waitUntil: (p) => tasks.push(p), fetcher,
    });
    expect(out).toEqual({ v: 9 }); // stale served immediately
    await Promise.all(tasks);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(store._data['k']).toContain('"v":2'); // refreshed
  });

  it('fails open: returns stale when revalidation throws', async () => {
    const old = 1_000_000;
    const store = memStore({ k: JSON.stringify({ data: { v: 9 }, cachedAt: old }) });
    const fetcher = vi.fn(async () => { throw new Error('WP down'); });
    const out = await cachedJson({ store, key: 'k', softTtlSec: SOFT, hardTtlSec: HARD, now: old + SOFT * 1000 + 1, fetcher });
    expect(out).toEqual({ v: 9 });
  });

  it('rethrows when fetch fails on a cold miss', async () => {
    const store = memStore();
    const fetcher = vi.fn(async () => { throw new Error('WP down'); });
    await expect(cachedJson({ store, key: 'k', softTtlSec: SOFT, hardTtlSec: HARD, now: 1, fetcher })).rejects.toThrow('WP down');
  });
});

describe('kvCacheStore', () => {
  it('delegates get/put to KV with expirationTtl', async () => {
    const calls: any[] = [];
    const kv = { async get(_k: string) { return null; }, async put(k: string, v: string, o?: any) { calls.push([k, v, o]); } };
    const store = kvCacheStore(kv);
    await store.put('k', 'v', 123);
    expect(calls[0]).toEqual(['k', 'v', { expirationTtl: 123 }]);
  });
});
