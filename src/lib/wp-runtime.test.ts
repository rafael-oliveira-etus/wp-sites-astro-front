import { describe, expect, it } from 'vitest';
import { wpAuthEnvKey } from './wp-runtime';

describe('wpAuthEnvKey', () => {
  it('builds WP_AUTH_<ID> uppercased', () => {
    expect(wpAuthEnvKey('limitemais')).toBe('WP_AUTH_LIMITEMAIS');
  });
  it('uppercases and underscores hyphenated ids', () => {
    expect(wpAuthEnvKey('tarjetas-ar')).toBe('WP_AUTH_TARJETAS_AR');
  });
});
