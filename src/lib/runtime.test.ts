import { describe, expect, it } from 'vitest';
import { resolveAdsMode } from './runtime';

describe('resolveAdsMode', () => {
  it('passes explicit modes through in any environment', () => {
    expect(resolveAdsMode('off', true)).toBe('off');
    expect(resolveAdsMode('test', true)).toBe('test');
    expect(resolveAdsMode('live', false)).toBe('live');
  });

  it('defaults by environment when unset or invalid', () => {
    expect(resolveAdsMode(undefined, true)).toBe('live');
    expect(resolveAdsMode(undefined, false)).toBe('test');
    expect(resolveAdsMode('garbage', true)).toBe('live');
    expect(resolveAdsMode('garbage', false)).toBe('test');
  });
});
