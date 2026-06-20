import { describe, expect, it } from 'vitest';
import { normalizeBoltConfig } from './wp-config';

describe('normalizeBoltConfig', () => {
  const raw = {
    // Mirror the real /bolt/v1/config shape: `site.name` is the theme's constant
    // display name ("Theme Bolt WP", identical across every tenant), while
    // `site.site_name` is the actual WordPress blogname (= wp/v2/settings.title).
    site: { name: 'Theme Bolt WP', site_name: 'Limite Mais' },
    branding: { logo_url: 'https://cdn/logo.webp', favicon_url: 'https://cdn/fav.webp' },
    config: { colors: { defaults: { identity_color: '#ff9a15', footer_bg: '#ff9a15', footer_bg_mob: '#F5EFF7' } } },
  };

  it('maps branding urls and identity color', () => {
    const c = normalizeBoltConfig(raw);
    expect(c.branding.logoUrl).toBe('https://cdn/logo.webp');
    expect(c.branding.faviconUrl).toBe('https://cdn/fav.webp');
    expect(c.colors.identity_color).toBe('#ff9a15');
    expect(c.colors.footer_bg_mob).toBe('#F5EFF7');
  });

  it('prefers site.site_name (real blogname) over site.name (theme default)', () => {
    // site.name is the theme constant "Theme Bolt WP" for every tenant, so the
    // real per-site title must come from site.site_name.
    expect(normalizeBoltConfig(raw).siteName).toBe('Limite Mais');
    expect(normalizeBoltConfig({ site: { name: 'Theme Bolt WP', site_name: 'Cardfácil' } }).siteName).toBe('Cardfácil');
    // falls back to site.name only when site_name is absent or empty
    expect(normalizeBoltConfig({ site: { name: 'Only Name' } }).siteName).toBe('Only Name');
    expect(normalizeBoltConfig({ site: { site_name: 'X' } }).siteName).toBe('X');
  });

  it('returns empty strings / empty colors on missing fields (no throw)', () => {
    const c = normalizeBoltConfig({});
    expect(c.branding.logoUrl).toBe('');
    expect(c.colors.identity_color).toBeUndefined();
    expect(c.siteName).toBe('');
    expect(c.tracking.gaId).toBe('');
    expect(c.tracking.facebookIdCC).toBe('');
  });

  it('maps features.tracking_ids to the tracking block', () => {
    const c = normalizeBoltConfig({
      features: {
        tracking_ids: {
          google_analytics: 'G-ABC123',
          gtm: 'GTM-XYZ',
          facebook_pixel_cc: '111',
          facebook_pixel_emp: '222',
          tiktok_pixel_cc: 'TT-CC',
          tiktok_pixel_emp: 'TT-EMP',
        },
      },
    });
    expect(c.tracking).toEqual({
      gaId: 'G-ABC123',
      gtmId: 'GTM-XYZ',
      facebookIdCC: '111',
      facebookIdEMP: '222',
      tiktokIdCC: 'TT-CC',
      tiktokIdEMP: 'TT-EMP',
    });
  });
});
