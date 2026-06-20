import { describe, expect, it } from 'vitest';
import { wpAuthEnvKey, wpAuthEnvKeyFor } from './wp-runtime';

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
