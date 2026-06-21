import { describe, it, expect } from 'vitest';
// Helpers live in pipeline-config.ts (pure) — NOT index.ts, which transitively
// imports the vendored SDK's `cloudflare:workers`, unresolvable under vitest.
import { SERVE_ROUTES, deviceCacheKey } from './pipeline-config';

describe('SERVE_ROUTES', () => {
  it('mirrors the wrangler.jsonc serving routes; cardfacil on the astro-dev subdomain, NOT the apex', () => {
    expect(SERVE_ROUTES).toContain('limitemais.com/*');
    expect(SERVE_ROUTES).toContain('www.limitemais.com/*');
    expect(SERVE_ROUTES).toContain('astro-dev.cardfacil.com/*');
    // The apex is the WP origin — routing it would loop SSR. Must not be served.
    expect(SERVE_ROUTES).not.toContain('cardfacil.com/*');
  });
});

describe('deviceCacheKey', () => {
  it('includes version and device, defaulting device to desktop', () => {
    expect(deviceCacheKey('1.2.3', 'mobile')).toBe('1.2.3:mobile');
    expect(deviceCacheKey('1.2.3', undefined)).toBe('1.2.3:desktop');
  });
});
