import { buildWpUrl, fetchJson, type WpDeps } from './wp';

export interface BoltColors {
  identity_color?: string;
  button_color?: string;
  button_color_hover?: string;
  button_font_color?: string;
  button_hover_font_color?: string;
  header_bg?: string;
  menu_font_color?: string;
  footer_bg?: string;
  footer_font_color?: string;
  footer_bg_mob?: string;
  footer_font_color_mob?: string;
  disclaimer_desktop?: string;
  disclaimer_mobile?: string;
}

/** Real tracking IDs from `features.tracking_ids` (BOLT config API). Empty string
 *  when unset. Keys mirror the boolean `features.tracking` flags. `gtmId` is kept
 *  for completeness but BOLT's tracking-pixels.php never loads a GTM container, so
 *  we don't either. */
export interface BoltTracking {
  gaId: string;
  gtmId: string;
  facebookIdCC: string;
  facebookIdEMP: string;
  tiktokIdCC: string;
  tiktokIdEMP: string;
}

export interface BoltConfig {
  colors: BoltColors;
  branding: { logoUrl: string; faviconUrl: string };
  siteName: string;
  tracking: BoltTracking;
}

const COLOR_KEYS: (keyof BoltColors)[] = [
  'identity_color', 'button_color', 'button_color_hover', 'button_font_color',
  'button_hover_font_color', 'header_bg', 'menu_font_color', 'footer_bg',
  'footer_font_color', 'footer_bg_mob', 'footer_font_color_mob',
  'disclaimer_desktop', 'disclaimer_mobile',
];

export function normalizeBoltConfig(raw: unknown): BoltConfig {
  const r = (raw ?? {}) as Record<string, any>;
  const defaults = (r.config?.colors?.defaults ?? {}) as Record<string, any>;
  const colors: BoltColors = {};
  for (const k of COLOR_KEYS) {
    const v = defaults[k];
    if (typeof v === 'string' && v) colors[k] = v;
  }
  const branding = (r.branding ?? {}) as Record<string, any>;
  const site = (r.site ?? {}) as Record<string, any>;
  const ids = (r.features?.tracking_ids ?? {}) as Record<string, any>;
  const id = (k: string) => String(ids[k] ?? '');
  return {
    colors,
    branding: {
      logoUrl: String(branding.logo_url ?? ''),
      faviconUrl: String(branding.favicon_url ?? ''),
    },
    siteName: String(site.name ?? site.site_name ?? ''),
    tracking: {
      gaId: id('google_analytics'),
      gtmId: id('gtm'),
      facebookIdCC: id('facebook_pixel_cc'),
      facebookIdEMP: id('facebook_pixel_emp'),
      tiktokIdCC: id('tiktok_pixel_cc'),
      tiktokIdEMP: id('tiktok_pixel_emp'),
    },
  };
}

/** GET /wp-json/bolt/v1/config with the BOLT client header. Returns null on any failure. */
export async function getBoltConfig(deps: WpDeps): Promise<BoltConfig | null> {
  try {
    const url = buildWpUrl(deps.baseUrl, '/bolt/v1/config');
    const raw = await fetchJson<unknown>(deps, url, { headers: { 'X-Etus-Bolt-Client': 'dash' } });
    return normalizeBoltConfig(raw);
  } catch {
    return null;
  }
}
