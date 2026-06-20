import { describe, expect, it } from 'vitest';
import { CSP_HEADER, cspForNonce } from './security';

describe('cspForNonce', () => {
  it('binds the given nonce into a strict-dynamic script-src', () => {
    const csp = cspForNonce('abc123==');
    expect(csp).toContain("script-src 'nonce-abc123==' 'strict-dynamic' 'unsafe-eval' https:");
  });

  it('locks down object-src and base-uri', () => {
    const csp = cspForNonce('n');
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
  });

  it('does NOT fall back to a host allowlist or unsafe-inline (strict CSP)', () => {
    const csp = cspForNonce('n');
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('doubleclick');
    expect(csp).not.toContain('googlesyndication');
  });

  it('ships Report-Only first (never blocks until flipped)', () => {
    expect(CSP_HEADER).toBe('Content-Security-Policy-Report-Only');
  });
});
