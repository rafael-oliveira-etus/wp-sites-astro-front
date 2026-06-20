import { describe, it, expect } from 'vitest';
import { DEFAULT_BRAND } from './schemas';
import type { Tenant } from './schemas';
import { buildWebSiteSchema, buildWebPageSchema } from './seo';

// Minimal tenant with no display — localeDisplay returns DEFAULT_DISPLAY (siteName: '')
const minimalTenant = {
  id: 'cf',
  domains: ['cf.com'],
  defaultLocale: 'pt-br',
  locales: ['pt-br'],
  brand: DEFAULT_BRAND,
  blog: { wpBaseUrl: 'https://cf.com' },
} as unknown as Tenant;

describe('buildWebSiteSchema siteName override', () => {
  it('uses the override when provided (BOLT site name wins over empty DEFAULT_DISPLAY)', () => {
    const schema = buildWebSiteSchema(minimalTenant, 'pt-br', 'Cartão Fácil');
    expect(schema.name).toBe('Cartão Fácil');
  });

  it('falls back to DEFAULT_DISPLAY.siteName when no override given (empty string — documents prior behavior)', () => {
    const schema = buildWebSiteSchema(minimalTenant, 'pt-br');
    expect(schema.name).toBe('');
  });
});

describe('buildWebPageSchema siteName override', () => {
  it('sets isPartOf.name to override when siteName provided', () => {
    const schema = buildWebPageSchema(minimalTenant, 'pt-br', {
      title: 'T',
      description: 'D',
      url: 'https://x/y',
      siteName: 'Cartão Fácil',
    });
    expect((schema.isPartOf as Record<string, unknown>).name).toBe('Cartão Fácil');
  });
});
