import { describe, expect, it } from 'vitest';
import { matchHost } from './sites.config';
import type { Tenant } from './schemas';

const fake = (id: string, domains: string[]) => ({ id, domains } as unknown as Tenant);
const SITES = {
  limitemais: fake('limitemais', ['limitemais.com', 'www.limitemais.com']),
  other: fake('other', ['outro.com.br']),
};

describe('matchHost', () => {
  it('matches the apex domain exactly', () => {
    expect(matchHost('limitemais.com', SITES)?.id).toBe('limitemais');
  });
  it('matches www and arbitrary subdomains by suffix', () => {
    expect(matchHost('www.limitemais.com', SITES)?.id).toBe('limitemais');
    expect(matchHost('staging.limitemais.com', SITES)?.id).toBe('limitemais');
  });
  it('ignores port and trailing dot, case-insensitive', () => {
    expect(matchHost('LimiteMais.com:8788', SITES)?.id).toBe('limitemais');
    expect(matchHost('limitemais.com.', SITES)?.id).toBe('limitemais');
  });
  it('routes a different domain to its own tenant', () => {
    expect(matchHost('outro.com.br', SITES)?.id).toBe('other');
  });
  it('returns null for unknown hosts', () => {
    expect(matchHost('example.com', SITES)).toBeNull();
    expect(matchHost('localhost', SITES)).toBeNull();
    expect(matchHost(undefined, SITES)).toBeNull();
  });
  it('does NOT match a look-alike suffix (anti spoof)', () => {
    expect(matchHost('limitemais.com.evil.com', SITES)).toBeNull();
  });
});
