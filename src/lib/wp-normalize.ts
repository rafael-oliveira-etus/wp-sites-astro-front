import type { WpAuthor, WpMedia, WpPost, WpTerm, WpYoast } from './wp-types';

// WP rendered strings carry HTML entities; decode the handful that appear in titles/excerpts.
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&#0*38;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0*39;/g, "'").replace(/&#8217;/g, '\u2019')
    .replace(/&nbsp;/g, ' ');
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, '').trim();
}

export function normalizeWpAuthor(raw: unknown): WpAuthor {
  const a = (raw ?? {}) as Record<string, any>;
  const avatars = a.avatar_urls as Record<string, string> | undefined;
  return {
    id: Number(a.id ?? 0),
    name: decodeEntities(String(a.name ?? '')),
    slug: String(a.slug ?? ''),
    link: String(a.link ?? ''),
    bio: decodeEntities(stripTags(String(a.description ?? ''))),
    avatar: avatars?.['96'] ?? avatars?.['48'],
  };
}

export function normalizeWpTerm(raw: unknown): WpTerm {
  const t = (raw ?? {}) as Record<string, any>;
  return {
    id: Number(t.id ?? 0),
    slug: String(t.slug ?? ''),
    name: decodeEntities(String(t.name ?? '')),
    taxonomy: String(t.taxonomy ?? ''),
    link: String(t.link ?? ''),
  };
}

function normalizeMedia(raw: unknown): WpMedia | null {
  const m = (raw ?? null) as Record<string, any> | null;
  if (!m || !m.source_url) return null;
  const sizes = m.media_details?.sizes as Record<string, any> | undefined;
  const full = sizes?.full ?? sizes?.large;
  let srcset: Array<{ url: string; width: number }> | undefined;
  if (sizes) {
    const byWidth = new Map<number, string>();
    for (const s of Object.values(sizes)) {
      const url = s?.source_url ? String(s.source_url) : '';
      const width = Number(s?.width);
      if (url && Number.isFinite(width) && width > 0 && !byWidth.has(width)) {
        byWidth.set(width, url);
      }
    }
    const entries = [...byWidth.entries()].sort((a, b) => a[0] - b[0]);
    if (entries.length) srcset = entries.map(([width, url]) => ({ url, width }));
  }
  return {
    sourceUrl: String(m.source_url),
    width: full?.width ?? m.media_details?.width,
    height: full?.height ?? m.media_details?.height,
    alt: decodeEntities(String(m.alt_text ?? '')),
    srcset,
  };
}

function normalizeYoast(raw: unknown): WpYoast | null {
  const y = (raw ?? null) as Record<string, any> | null;
  if (!y) return null;
  const ogImage = Array.isArray(y.og_image) && y.og_image[0]?.url ? String(y.og_image[0].url) : undefined;
  const desc = y.og_description ?? y.description;
  return {
    title: y.title ? decodeEntities(String(y.title)) : undefined,
    description: desc ? decodeEntities(String(desc)) : undefined,
    canonical: y.canonical ? String(y.canonical) : undefined,
    robots: y.robots && typeof y.robots === 'object' ? (y.robots as Record<string, string>) : undefined,
    ogImage,
    articlePublishedTime: y.article_published_time ? String(y.article_published_time) : undefined,
    articleModifiedTime: y.article_modified_time ? String(y.article_modified_time) : undefined,
  };
}

export function normalizeWpPost(raw: unknown): WpPost {
  const p = (raw ?? {}) as Record<string, any>;
  const embedded = (p._embedded ?? {}) as Record<string, any>;
  const authorRaw = Array.isArray(embedded.author) ? embedded.author[0] : undefined;
  const mediaRaw = Array.isArray(embedded['wp:featuredmedia']) ? embedded['wp:featuredmedia'][0] : undefined;
  const termGroups = Array.isArray(embedded['wp:term']) ? embedded['wp:term'] : [];
  const terms: WpTerm[] = termGroups.flat().filter(Boolean).map(normalizeWpTerm);

  return {
    id: Number(p.id ?? 0),
    slug: String(p.slug ?? ''),
    link: String(p.link ?? ''),
    title: decodeEntities(stripTags(String(p.title?.rendered ?? ''))),
    subtitle: decodeEntities(stripTags(String(p.meta?.post_subtitle ?? ''))),
    excerpt: decodeEntities(stripTags(String(p.excerpt?.rendered ?? ''))),
    contentHtml: String(p.content?.rendered ?? ''),
    publishedAt: new Date(String(p.date_gmt ?? p.date ?? 0) + (String(p.date_gmt ?? '').endsWith('Z') ? '' : 'Z')),
    updatedAt: new Date(String(p.modified_gmt ?? p.modified ?? 0) + (String(p.modified_gmt ?? '').endsWith('Z') ? '' : 'Z')),
    author: authorRaw ? normalizeWpAuthor(authorRaw) : null,
    featuredMedia: normalizeMedia(mediaRaw),
    terms,
    yoast: normalizeYoast(p.yoast_head_json),
  };
}
