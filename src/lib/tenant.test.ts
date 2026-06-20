import { describe, it, expect } from 'vitest';
import { localeDisplay } from './tenant';
import { DEFAULT_DISPLAY } from './default-display';
import { DEFAULT_BRAND } from './schemas';
import type { Tenant } from './schemas';

const base = {
  id: 'x',
  domains: ['x.com'],
  defaultLocale: 'pt-br',
  locales: ['pt-br'],
  brand: DEFAULT_BRAND,
} as unknown as Tenant;

describe('localeDisplay fallback', () => {
  it('returns DEFAULT_DISPLAY when tenant has no display', () => {
    const t = { ...base, display: undefined } as unknown as Tenant;
    expect(localeDisplay(t, 'pt-br')).toBe(DEFAULT_DISPLAY);
  });

  it('returns the tenant block when present', () => {
    const custom = { ...DEFAULT_DISPLAY, siteName: 'Custom' };
    const t = { ...base, display: { 'pt-br': custom } } as unknown as Tenant;
    expect(localeDisplay(t, 'pt-br').siteName).toBe('Custom');
  });
});
