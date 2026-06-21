import { describe, expect, it, vi } from 'vitest';
import { wpAuthEnvKey, wpAuthEnvKeyFor, waitUntilFrom, withMaestroBypass } from './wp-runtime';

describe('withMaestroBypass', () => {
  const mockFetch = () =>
    vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => Promise.resolve(new Response('ok')));

  it('adds X-Etus-Maestro: bypass to every request, preserving existing headers', async () => {
    const base = mockFetch();
    const f = withMaestroBypass(base as unknown as typeof fetch);
    await f('https://cardfacil.com/wp-json/wp/v2/posts', { headers: { accept: 'application/json' } });
    const headers = new Headers(base.mock.calls[0]![1]?.headers);
    expect(headers.get('X-Etus-Maestro')).toBe('bypass');
    expect(headers.get('accept')).toBe('application/json');
  });

  it('works when no init/headers are passed', async () => {
    const base = mockFetch();
    const f = withMaestroBypass(base as unknown as typeof fetch);
    await f('https://cardfacil.com/wp-json/');
    const headers = new Headers(base.mock.calls[0]![1]?.headers);
    expect(headers.get('X-Etus-Maestro')).toBe('bypass');
  });
});

describe('wpAuthEnvKey', () => {
  it('builds WP_AUTH_<ID> uppercased', () => {
    expect(wpAuthEnvKey('limitemais')).toBe('WP_AUTH_LIMITEMAIS');
  });
  it('uppercases and underscores hyphenated ids', () => {
    expect(wpAuthEnvKey('tarjetas-ar')).toBe('WP_AUTH_TARJETAS_AR');
  });
});

describe('wpAuthEnvKeyFor', () => {
  it('prefers the explicit wpAuthEnv', () => {
    expect(wpAuthEnvKeyFor({ id: 'cardfacil', wpAuthEnv: 'WP_AUTH_CARDFACIL' }))
      .toBe('WP_AUTH_CARDFACIL');
  });
  it('falls back to the derived WP_AUTH_<ID> when wpAuthEnv is absent', () => {
    expect(wpAuthEnvKeyFor({ id: 'limitemais' })).toBe('WP_AUTH_LIMITEMAIS');
  });
});

describe('waitUntilFrom', () => {
  it('returns the cfContext waitUntil bound to its ctx', () => {
    const calls: Array<{ thisArg: unknown; arg: unknown }> = [];
    const ctx = {
      waitUntil(this: unknown, p: Promise<unknown>) {
        calls.push({ thisArg: this, arg: p });
      },
    };
    const fn = waitUntilFrom({ cfContext: ctx });
    expect(typeof fn).toBe('function');
    const p = Promise.resolve();
    fn!(p);
    // bound to ctx (not invoked detached, which the runtime's waitUntil rejects)
    expect(calls).toEqual([{ thisArg: ctx, arg: p }]);
  });

  it('returns undefined when cfContext / waitUntil is absent', () => {
    expect(waitUntilFrom({})).toBeUndefined();
    expect(waitUntilFrom({ cfContext: {} })).toBeUndefined();
  });

  it('returns undefined (never throws) for null/garbage locals', () => {
    expect(waitUntilFrom(null)).toBeUndefined();
    expect(waitUntilFrom(undefined)).toBeUndefined();
    expect(waitUntilFrom(42)).toBeUndefined();
  });
});
