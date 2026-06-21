import { describe, it, expect } from 'vitest';
// Helpers live in pipeline-config.ts (pure) — NOT index.ts, which transitively
// imports the vendored SDK's `cloudflare:workers`, unresolvable under vitest.
import { buildRoutes, deviceCacheKey } from './pipeline-config';

describe('buildRoutes', () => {
  it('emits one host/* route per tenant domain, deduped', () => {
    const routes = buildRoutes({
      a: { domains: ['limitemais.com', 'www.limitemais.com'] },
      b: { domains: ['cardfacil.com'] },
    });
    expect(routes).toContain('limitemais.com/*');
    expect(routes).toContain('www.limitemais.com/*');
    expect(routes).toContain('cardfacil.com/*');
    expect(new Set(routes).size).toBe(routes.length);
  });
});

describe('deviceCacheKey', () => {
  it('includes version and device, defaulting device to desktop', () => {
    expect(deviceCacheKey('1.2.3', 'mobile')).toBe('1.2.3:mobile');
    expect(deviceCacheKey('1.2.3', undefined)).toBe('1.2.3:desktop');
  });
});
