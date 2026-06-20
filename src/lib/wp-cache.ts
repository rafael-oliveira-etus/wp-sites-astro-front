export interface CacheStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, hardTtlSec: number): Promise<void>;
}
export interface KvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

export function kvCacheStore(kv: KvLike): CacheStore {
  return {
    get: (key) => kv.get(key),
    put: (key, value, hardTtlSec) => kv.put(key, value, { expirationTtl: hardTtlSec }),
  };
}

interface Envelope<T> { data: T; cachedAt: number; }

export async function cachedJson<T>(opts: {
  store: CacheStore; key: string; softTtlSec: number; hardTtlSec: number;
  now: number; waitUntil?: (p: Promise<unknown>) => void;
  fetcher: () => Promise<T>;
}): Promise<T> {
  const { store, key, softTtlSec, hardTtlSec, now, waitUntil, fetcher } = opts;

  const refresh = async (): Promise<T> => {
    const data = await fetcher();
    await store.put(key, JSON.stringify({ data, cachedAt: now } satisfies Envelope<T>), hardTtlSec);
    return data;
  };

  const rawCached = await store.get(key);
  if (!rawCached) return refresh(); // cold miss: fetch or throw

  let env: Envelope<T> | null = null;
  try { env = JSON.parse(rawCached) as Envelope<T>; } catch { env = null; }
  if (!env) return refresh();

  const fresh = now - env.cachedAt < softTtlSec * 1000;
  if (fresh) return env.data;

  // Stale: serve immediately, revalidate out of band, fail open on error.
  const revalidate = refresh().catch(() => env!.data);
  if (waitUntil) { waitUntil(revalidate); return env.data; }
  // No waitUntil (e.g. dev): still serve stale, kick refresh without awaiting failure.
  void revalidate;
  return env.data;
}
