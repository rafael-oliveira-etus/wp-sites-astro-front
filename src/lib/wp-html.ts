import { addHeadingIds, rewriteImages, type PostHeading, type RenderedPost } from './markdown';
import type { WpMedia } from './wp-types';

export function wpSrcset(media: WpMedia | null | undefined): string | undefined {
  if (!media?.srcset?.length) return undefined;
  return media.srcset.map((s) => `${s.url} ${s.width}w`).join(', ');
}

// WP content is our own, but defend against stored-XSS regressions: drop active
// content and inline event handlers before the HTML reaches the page.
function sanitize(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '');
}

/** The WP origin and its www/non-www twin, normalized (no trailing slash). */
export function wpOriginVariants(wpBaseUrl: string): string[] {
  let origin: string;
  try {
    origin = new URL(wpBaseUrl).origin;
  } catch {
    return [];
  }
  const twin = origin.includes('://www.')
    ? origin.replace('://www.', '://')
    : origin.replace('://', '://www.');
  return [origin, twin];
}

/**
 * Rewrite anchor hrefs that point at the WordPress origin to root-relative paths,
 * so internal links stay inside this app (this is the WP frontend, not WP itself).
 * Media/asset hosts (e.g. media.limitemais.com) and external links are untouched.
 */
export function rewriteLinks(html: string, wpBaseUrl: string): string {
  const origins = wpOriginVariants(wpBaseUrl);
  if (origins.length === 0) return html;
  return html.replace(/(<a\b[^>]*?\bhref=")([^"]+)(")/gi, (m, pre: string, href: string, post: string) => {
    for (const o of origins) {
      if (href === o || href === `${o}/`) return `${pre}/${post}`;
      if (href.startsWith(`${o}/`)) return `${pre}${href.slice(o.length)}${post}`;
    }
    return m;
  });
}

export function renderWpContent(
  contentHtml: string,
  // `rewriteImages` (default true) keeps body images linked to their WP/CDN source
  // (never downloaded) and only ensures loading=lazy/decoding=async — WP's own
  // srcset/sizes/width/height pass through untouched. Site chrome (footer widgets)
  // is already lazy from WP, so pass false there to leave it byte-for-byte.
  opts: { wpBaseUrl?: string; rewriteImages?: boolean } = {},
): RenderedPost {
  let clean = sanitize(contentHtml);
  if (opts.wpBaseUrl) clean = rewriteLinks(clean, opts.wpBaseUrl);
  const headings: PostHeading[] = [];
  const seen = new Map<string, number>();
  const withIds = addHeadingIds(clean, seen, headings);
  const html = opts.rewriteImages === false ? withIds : rewriteImages(withIds);
  return { html, headings };
}
