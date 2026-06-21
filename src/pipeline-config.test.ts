import { describe, it, expect } from 'vitest';
// Helpers live in pipeline-config.ts (pure) — NOT index.ts, which transitively
// imports the vendored SDK's `cloudflare:workers`, unresolvable under vitest.
import { SERVE_ROUTES, deviceCacheKey } from './pipeline-config';

describe('SERVE_ROUTES', () => {
  it('mirrors the maestro serving routes; only the specific limitemais landing path, never an apex catch-all', () => {
    // limitemais production: ONLY this one post path is served by the worker; the
    // rest of limitemais.com stays on WordPress (maestro passes it through).
    // Trailing `*` (not `/*`) so it matches the URL with OR without the trailing
    // slash — Astro serves both forms.
    expect(SERVE_ROUTES).toContain('limitemais.com/s1-tk-cartao-de-credito-credcesta-visa*');
    expect(SERVE_ROUTES).toContain('astro-dev.limitemais.com/*');
    expect(SERVE_ROUTES).toContain('astro-dev.cardfacil.com/*');
    // An apex catch-all is the WP origin — routing it would loop the WP REST fetch
    // back through maestro into SSR. Must never be served.
    expect(SERVE_ROUTES).not.toContain('limitemais.com/*');
    expect(SERVE_ROUTES).not.toContain('www.limitemais.com/*');
    expect(SERVE_ROUTES).not.toContain('cardfacil.com/*');
  });
});

describe('deviceCacheKey', () => {
  it('includes version and device, defaulting device to desktop', () => {
    expect(deviceCacheKey('1.2.3', 'mobile')).toBe('1.2.3:mobile');
    expect(deviceCacheKey('1.2.3', undefined)).toBe('1.2.3:desktop');
  });
});
