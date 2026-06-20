import { describe, expect, it } from 'vitest';
import { wpSrcset, renderWpContent, rewriteLinks } from './wp-html';

describe('rewriteLinks', () => {
  const WP = 'https://limitemais.com';
  it('relativizes anchors pointing at the WP origin', () => {
    const html = '<a href="https://limitemais.com/emprestimo">cat</a> <a href="https://limitemais.com/author/hank">a</a>';
    const out = rewriteLinks(html, WP);
    expect(out).toContain('href="/emprestimo"');
    expect(out).toContain('href="/author/hank"');
    expect(out).not.toContain('https://limitemais.com/emprestimo');
  });
  it('relativizes the www twin too', () => {
    expect(rewriteLinks('<a href="https://www.limitemais.com/x">x</a>', WP)).toContain('href="/x"');
  });
  it('maps the bare origin to "/"', () => {
    expect(rewriteLinks('<a href="https://limitemais.com">home</a>', WP)).toContain('href="/"');
  });
  it('leaves media/CDN and external links untouched', () => {
    const html = '<img src="https://media.limitemais.com/a.png"><a href="https://example.com/x">ext</a>';
    const out = rewriteLinks(html, WP);
    expect(out).toContain('https://media.limitemais.com/a.png');
    expect(out).toContain('https://example.com/x');
  });
  it('rewrites body links through renderWpContent when wpBaseUrl is given', () => {
    const { html } = renderWpContent('<p><a href="https://limitemais.com/post-x">link</a></p>', { wpBaseUrl: WP });
    expect(html).toContain('href="/post-x"');
    expect(html).not.toContain('https://limitemais.com/post-x');
  });
});

describe('renderWpContent', () => {
  it('collects h2/h3 headings with ids for the TOC', () => {
    const { html, headings } = renderWpContent('<h2>First</h2><p>x</p><h3>Sub</h3>');
    expect(headings).toEqual([
      { depth: 2, id: 'first', text: 'First' },
      { depth: 3, id: 'sub', text: 'Sub' },
    ]);
    expect(html).toContain('id="first"');
    expect(html).toContain('id="sub"');
  });

  it('strips <script> and <style> blocks', () => {
    const { html } = renderWpContent('<p>ok</p><script>alert(1)</script><style>.x{}</style>');
    expect(html).toContain('<p>ok</p>');
    expect(html).not.toContain('alert(1)');
    expect(html).not.toContain('.x{}');
    expect(html.toLowerCase()).not.toContain('<script');
    expect(html.toLowerCase()).not.toContain('<style');
  });

  it('strips inline on* event-handler attributes', () => {
    const { html } = renderWpContent('<p onclick="evil()">hi</p><a href="/x" onmouseover="bad()">l</a>');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('onmouseover');
    expect(html).toContain('href="/x"');
    expect(html).toContain('hi');
  });

  it('rewrites <img> through the shared image rewriter', () => {
    const { html } = renderWpContent('<img src="https://media.limitemais.com/a.png" alt="A">');
    expect(html).toContain('media.limitemais.com/a.png');
    expect(html).toMatch(/<picture|<img/);
  });

  it('passes real WP body markup through without throwing', () => {
    const real = '<section class="lazy-load"><p>Quem possui um imóvel…</p><h2>Consequências</h2><p>…</p></section>';
    const { html, headings } = renderWpContent(real);
    expect(html).toContain('Consequências');
    expect(headings.some((h) => h.text === 'Consequências')).toBe(true);
  });
});

describe('wpSrcset', () => {
  it('formats a srcset string from media.srcset', () => {
    expect(wpSrcset({ sourceUrl: 'x', alt: '', srcset: [
      { url: 'https://cdn/a.png', width: 300 },
      { url: 'https://cdn/b.png', width: 640 },
    ] })).toBe('https://cdn/a.png 300w, https://cdn/b.png 640w');
  });
  it('returns undefined when no srcset', () => {
    expect(wpSrcset({ sourceUrl: 'x', alt: '' })).toBeUndefined();
    expect(wpSrcset(null)).toBeUndefined();
  });
});

describe('renderWpContent inline images', () => {
  it('emits lazy/async inline images (via the picture pipeline)', () => {
    const { html } = renderWpContent('<p><img src="https://media.limitemais.com/x.png" alt="x"></p>', { wpBaseUrl: 'https://limitemais.com' });
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
  });
});
