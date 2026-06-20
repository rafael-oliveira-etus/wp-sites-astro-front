import { buildWpUrl, fetchJson, type WpDeps } from './wp';
import { renderWpContent } from './wp-html';

export interface FooterWidgets {
  leftDesktop: string;
  leftMobile: string;
  subfooterLeft: string;
  disclaimer: string;
}

const AREA_TO_KEY: Record<string, keyof FooterWidgets> = {
  'left-footer-widget': 'leftDesktop',
  'left-footer-widget-mob': 'leftMobile',
  'subfooter-left-widget': 'subfooterLeft',
  'disclaimer': 'disclaimer',
};

export function normalizeFooterWidgets(rawWidgets: unknown): FooterWidgets {
  const out: FooterWidgets = { leftDesktop: '', leftMobile: '', subfooterLeft: '', disclaimer: '' };
  const arr = Array.isArray(rawWidgets) ? rawWidgets : [];
  for (const raw of arr) {
    const w = (raw ?? {}) as Record<string, any>;
    const key = AREA_TO_KEY[String(w.sidebar ?? '')];
    if (!key) continue;
    out[key] += String(w.rendered ?? '');
  }
  return out;
}

/** GET /wp/v2/widgets (authenticated) → grouped, sanitized footer-area HTML. */
export async function getFooterWidgets(deps: WpDeps): Promise<FooterWidgets> {
  try {
    const url = buildWpUrl(deps.baseUrl, '/wp/v2/widgets', { context: 'edit', per_page: 100 });
    const raw = await fetchJson<unknown>(deps, url, { auth: true });
    const grouped = normalizeFooterWidgets(raw);
    // Footer widgets are chrome: keep their original <img> (width/height/srcset
    // from WP) instead of running them through the blog body-image pipeline.
    const clean = (h: string) => (h ? renderWpContent(h, { wpBaseUrl: deps.baseUrl, rewriteImages: false }).html : '');
    return {
      leftDesktop: clean(grouped.leftDesktop),
      leftMobile: clean(grouped.leftMobile),
      subfooterLeft: clean(grouped.subfooterLeft),
      disclaimer: clean(grouped.disclaimer),
    };
  } catch {
    return { leftDesktop: '', leftMobile: '', subfooterLeft: '', disclaimer: '' };
  }
}
