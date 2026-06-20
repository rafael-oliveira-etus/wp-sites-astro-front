import { Marked } from 'marked';

/** Shared Marked instance used by `renderPost`. */
export const marked = new Marked({
  gfm: true,
  breaks: false,
});

export interface PostHeading {
  depth: 2 | 3;
  id: string;
  text: string;
}

export interface RenderedPost {
  html: string;
  headings: PostHeading[];
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Add unique `id`s to h2/h3 + collect the outline. `seen` (slug → count) and
 * `headings` are passed IN so the transform can be threaded across multiple HTML
 * segments (ad-injected blocks) and still produce globally-unique ids + one TOC.
 * marked emits bare `<h2>…</h2>` (no attrs), so rewriting the tag in place is safe.
 */
export function addHeadingIds(html: string, seen: Map<string, number>, headings: PostHeading[]): string {
  return html.replace(/<(h[23])>([\s\S]*?)<\/\1>/gi, (_match, tag: string, inner: string) => {
    const text = inner.replace(/<[^>]+>/g, '').trim();
    const base = slugify(text) || 'section';
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    const id = n > 0 ? `${base}-${n}` : base;
    headings.push({ depth: tag === 'h2' ? 2 : 3, id, text });
    return `<${tag} id="${id}">${inner}</${tag}>`;
  });
}

/**
 * Content images stay LINKED to their source — WordPress/CDN serves them, we never
 * download or rewrite the URL, so WP's own `srcset`/`sizes`/`width`/`height` are
 * preserved untouched. We only ensure `loading="lazy"` + `decoding="async"` are
 * present (added when missing) for CLS/perf.
 */
export function rewriteImages(html: string): string {
  return html.replace(/<img\b([^>]*)>/gi, (_m, attrs) => {
    let a = String(attrs).replace(/\s*\/\s*$/, '');
    if (!/\bloading\s*=/i.test(a)) a += ' loading="lazy"';
    if (!/\bdecoding\s*=/i.test(a)) a += ' decoding="async"';
    return `<img${a}>`;
  });
}

/**
 * Strip WP affiliate shortcodes that survive import as raw body text. Today:
 * `[button url=… ]label[/button]` — the CTA is rendered from the post's
 * `exitLink` (editorial Editor's-pick card / classic exit button), so the raw
 * shortcode is duplicate noise. Idempotent; safe to call more than once.
 */
export function stripShortcodes(md: string): string {
  return md.replace(/\[button\b[^\]]*\][\s\S]*?\[\/button\]/gi, '');
}

// Render the post body AND extract an h2/h3 outline in a single pass.
export function renderPost(source: string): RenderedPost {
  const rawHtml = marked.parse(stripShortcodes(source), { async: false }) as string;
  const headings: PostHeading[] = [];
  const seen = new Map<string, number>();
  const html = rewriteImages(addHeadingIds(rawHtml, seen, headings));
  return { html, headings };
}
