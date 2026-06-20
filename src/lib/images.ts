// Blog image manifest — baked by astro.config (vite.define) from the output of
// scripts/post-images.mjs. Maps an original WP image URL → intrinsic dimensions
// + optimized derivatives (AVIF/WebP/fallback × widths) + a stable R2 key.
//
// PUBLIC_IMAGE_BASE (env, baked) is the R2/CDN base the derivatives are served
// from. Until it's set, the renderer keeps the original WP URL but adds correct
// width/height (CLS fix) + lazy/async; once set, it emits a responsive <picture>
// from the optimized derivatives.

interface ImageEntry {
  id: string;
  width: number;
  height: number;
  widths: number[];
  derivatives: { avif: Record<string, string>; webp: Record<string, string>; fallback: string };
  r2KeyBase: string;
}

let _images: Record<string, ImageEntry> | null = null;
function images(): Record<string, ImageEntry> {
  if (_images) return _images;
  try {
    _images = (JSON.parse(import.meta.env.IMAGE_MANIFEST || '{"images":{}}').images as Record<string, ImageEntry>) || {};
  } catch {
    _images = {};
  }
  return _images;
}

export function imageInfo(url: string): ImageEntry | null {
  return images()[url] || null;
}

export const IMAGE_BASE: string = (import.meta.env.PUBLIC_IMAGE_BASE || '').replace(/\/$/, '');

const esc = (s: string) => s.replace(/"/g, '&quot;');

// HTML for a content image: <picture> with responsive AVIF/WebP from R2 once
// IMAGE_BASE is set, else the original URL — always with intrinsic width/height
// (CLS) + loading=lazy decoding=async.
export function pictureHtml(
  url: string,
  alt = '',
  opts: { eager?: boolean; sizes?: string } = {},
): string {
  const a = ` alt="${esc(alt)}"`;
  // The lead/LCP image is eager + high priority; body images stay lazy.
  const lazy = opts.eager ? 'fetchpriority="high" decoding="async"' : 'loading="lazy" decoding="async"';
  const info = imageInfo(url);
  if (!info) return `<img src="${url}"${a} ${lazy}>`;
  const dims = `width="${info.width}" height="${info.height}"`;
  if (!IMAGE_BASE) return `<img src="${url}"${a} ${dims} ${lazy}>`;
  const base = `${IMAGE_BASE}/${info.r2KeyBase}`;
  const sizes = opts.sizes ?? '(min-width: 1024px) 44rem, 100vw';
  const srcset = (fmt: 'avif' | 'webp') => info.widths.map((w) => `${base}${info.derivatives[fmt][w]} ${w}w`).join(', ');
  const fallback = `${base}${info.derivatives.fallback}`;
  return (
    `<picture>` +
    `<source type="image/avif" srcset="${srcset('avif')}" sizes="${sizes}">` +
    `<source type="image/webp" srcset="${srcset('webp')}" sizes="${sizes}">` +
    `<img src="${fallback}"${a} ${dims} ${lazy}>` +
    `</picture>`
  );
}
