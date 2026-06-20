import { describe, expect, it } from 'vitest';
import raw from './__fixtures__/wp-post.json';
import { normalizeWpPost } from './wp-normalize';

describe('normalizeWpPost', () => {
  const post = normalizeWpPost(raw);

  it('maps core fields', () => {
    expect(typeof post.id).toBe('number');
    expect(post.slug).toBeTruthy();
    expect(post.title).not.toContain('<'); // title is plain text (tags stripped)
    expect(post.contentHtml).toContain('<'); // body is HTML
  });

  it('uses date_gmt for publishedAt (UTC)', () => {
    expect(post.publishedAt).toBeInstanceOf(Date);
    expect(post.publishedAt.toISOString()).toMatch(/Z$/);
  });

  it('extracts the embedded author', () => {
    expect(post.author?.name).toBeTruthy();
    expect(post.author?.slug).toBeTruthy();
  });

  it('extracts featured media with a source url', () => {
    expect(post.featuredMedia?.sourceUrl ?? '').toMatch(/^https?:\/\//);
  });

  it('maps yoast og_description to description field with entity decoding', () => {
    const rawYoast = (raw as any).yoast_head_json;
    expect(rawYoast?.og_description).toBeDefined();
    // The og_description from the fixture should be decoded and available
    expect(post.yoast?.description).toBeTruthy();
    expect(post.yoast?.description).toBe(rawYoast.og_description);
  });

  it('falls back to top-level description when og_description is missing', () => {
    const synthetic = {
      yoast_head_json: {
        description: 'Plain meta desc',
      },
    };
    const result = normalizeWpPost(synthetic);
    expect(result.yoast?.description).toBe('Plain meta desc');
  });

  it('maps meta.post_subtitle to subtitle (entity-decoded, tags stripped)', () => {
    const withSub = normalizeWpPost({ meta: { post_subtitle: 'Dinheiro &amp; <em>crédito</em>' } });
    expect(withSub.subtitle).toBe('Dinheiro & crédito');
  });

  it('returns empty subtitle when meta or post_subtitle is absent', () => {
    expect(normalizeWpPost({}).subtitle).toBe('');
    expect(normalizeWpPost({ meta: {} }).subtitle).toBe('');
    expect(normalizeWpPost({ meta: { post_subtitle: '' } }).subtitle).toBe('');
  });

  it('returns null author/media instead of throwing when _embedded is absent', () => {
    const bare = { ...(raw as any), _embedded: undefined };
    const p = normalizeWpPost(bare);
    expect(p.author).toBeNull();
    expect(p.featuredMedia).toBeNull();
  });
});

describe('normalizeMedia srcset', () => {
  const raw = {
    id: 1, slug: 'p', title: { rendered: 'P' }, excerpt: { rendered: '' },
    content: { rendered: '' }, date_gmt: '2024-01-01T00:00:00',
    _embedded: { 'wp:featuredmedia': [{
      source_url: 'https://cdn/img.png', alt_text: 'a',
      media_details: { width: 768, height: 512, sizes: {
        medium: { source_url: 'https://cdn/img-300.png', width: 300, height: 200 },
        'img-640': { source_url: 'https://cdn/img-640.png', width: 640, height: 427 },
        full: { source_url: 'https://cdn/img.png', width: 768, height: 512 },
      } },
    }] },
  };
  it('collects sizes into an ascending, deduped srcset', () => {
    const post = normalizeWpPost(raw);
    expect(post.featuredMedia?.srcset).toEqual([
      { url: 'https://cdn/img-300.png', width: 300 },
      { url: 'https://cdn/img-640.png', width: 640 },
      { url: 'https://cdn/img.png', width: 768 },
    ]);
    expect(post.featuredMedia?.sourceUrl).toBe('https://cdn/img.png');
  });
  it('leaves srcset undefined when there are no sizes', () => {
    const r2 = { ...raw, _embedded: { 'wp:featuredmedia': [{ source_url: 'https://cdn/x.png', media_details: {} }] } };
    expect(normalizeWpPost(r2).featuredMedia?.srcset).toBeUndefined();
  });
});
