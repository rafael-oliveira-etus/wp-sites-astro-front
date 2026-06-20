import { describe, expect, it } from 'vitest';
import { matchHost, SITES, resolveTenantByHost } from './sites.config';
import { DEFAULT_BRAND } from './schemas';
import type { Tenant } from './schemas';

const fake = (id: string, domains: string[]) => ({ id, domains } as unknown as Tenant);
const FAKE_SITES = {
  limitemais: fake('limitemais', ['limitemais.com', 'www.limitemais.com']),
  other: fake('other', ['outro.com.br']),
};

describe('matchHost', () => {
  it('matches the apex domain exactly', () => {
    expect(matchHost('limitemais.com', FAKE_SITES)?.id).toBe('limitemais');
  });
  it('matches www and arbitrary subdomains by suffix', () => {
    expect(matchHost('www.limitemais.com', FAKE_SITES)?.id).toBe('limitemais');
    expect(matchHost('staging.limitemais.com', FAKE_SITES)?.id).toBe('limitemais');
  });
  it('ignores port and trailing dot, case-insensitive', () => {
    expect(matchHost('LimiteMais.com:8788', FAKE_SITES)?.id).toBe('limitemais');
    expect(matchHost('limitemais.com.', FAKE_SITES)?.id).toBe('limitemais');
  });
  it('routes a different domain to its own tenant', () => {
    expect(matchHost('outro.com.br', FAKE_SITES)?.id).toBe('other');
  });
  it('returns null for unknown hosts', () => {
    expect(matchHost('example.com', FAKE_SITES)).toBeNull();
    expect(matchHost('localhost', FAKE_SITES)).toBeNull();
    expect(matchHost(undefined, FAKE_SITES)).toBeNull();
  });
  it('does NOT match a look-alike suffix (anti spoof)', () => {
    expect(matchHost('limitemais.com.evil.com', FAKE_SITES)).toBeNull();
  });
});

describe('cardfacil bootstrap tenant', () => {
  it('resolves cardfacil for its apex/www/dev hosts', () => {
    expect(resolveTenantByHost('cardfacil.com')?.id).toBe('cardfacil');
    expect(resolveTenantByHost('www.cardfacil.com')?.id).toBe('cardfacil');
    expect(resolveTenantByHost('astro-dev.cardfacil.com')?.id).toBe('cardfacil');
  });
  it('still resolves limitemais and 404s unknown hosts', () => {
    expect(resolveTenantByHost('limitemais.com')?.id).toBe('limitemais');
    expect(resolveTenantByHost('totally-unknown-host.example')).toBeNull();
  });
  it('parse-at-load filled defaults for the minimal entry', () => {
    const t = SITES.cardfacil;
    expect(t.wpAuthEnv).toBe('WP_AUTH_CARDFACIL');
    expect(t.blog?.wpBaseUrl).toBe('https://cardfacil.com');
    expect(t.display).toBeUndefined();
    expect(t.seo).toBeUndefined();
    expect(t.brand).toEqual(DEFAULT_BRAND);
    expect(t.theme).toBe('classic');
    expect(t.tracking).toBeDefined();
  });
});
