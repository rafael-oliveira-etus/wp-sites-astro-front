import { describe, expect, it } from 'vitest';
import type { WpPost } from './wp-types';
import { wpArticleInput, wpPersonInput } from './wp-seo';
import { buildArticleSchema, buildPersonSchema } from './seo';

function makePost(over: Partial<WpPost> = {}): WpPost {
  return {
    id: 1, slug: 'meu-post', link: 'https://limitemais.com/meu-post/',
    title: 'Meu Post', excerpt: 'Resumo do post', contentHtml: '<p>x</p>',
    publishedAt: new Date('2024-01-02T03:04:05Z'), updatedAt: new Date('2024-02-02T03:04:05Z'),
    author: { id: 7, name: 'Renato Mesquita', slug: 'hank', link: 'https://limitemais.com/author/hank/', bio: 'Bio', avatar: 'https://x/a.png' },
    featuredMedia: { sourceUrl: 'https://media.limitemais.com/f.png', width: 768, height: 512, alt: 'f' },
    terms: [{ id: 37, slug: 'emprestimo', name: 'Empréstimo', taxonomy: 'category', link: 'https://limitemais.com/emprestimo/' }],
    yoast: { description: 'Yoast desc', ogImage: 'https://media.limitemais.com/og.png', canonical: 'https://limitemais.com/meu-post/' },
    ...over,
  };
}

describe('wpArticleInput', () => {
  it('uses canonical + author URLs from the caller, never the WP host', () => {
    const input = wpArticleInput(makePost(), 'https://tenant.example/meu-post', 'https://tenant.example/author/hank');
    expect(input.url).toBe('https://tenant.example/meu-post');
    expect(input.author.url).toBe('https://tenant.example/author/hank');
    // Canonical + author links must be tenant-domain; the WP host must not leak there.
    expect(input.url).not.toContain('limitemais.com');
    expect(input.author.url ?? '').not.toContain('limitemais.com');
    // NOTE: input.image intentionally stays on the WP CDN (media.limitemais.com) — images are not re-hosted (design W7).
    expect(input.image).toBe('https://media.limitemais.com/og.png');
  });

  it('prefers yoast description and ogImage', () => {
    const input = wpArticleInput(makePost(), 'https://tenant.example/meu-post');
    expect(input.description).toBe('Yoast desc');
    expect(input.image).toBe('https://media.limitemais.com/og.png');
  });

  it('falls back to excerpt and featured media when yoast is absent', () => {
    const input = wpArticleInput(makePost({ yoast: null }), 'https://tenant.example/meu-post');
    expect(input.description).toBe('Resumo do post');
    expect(input.image).toBe('https://media.limitemais.com/f.png');
  });

  it('carries the dates through unchanged', () => {
    const input = wpArticleInput(makePost(), 'https://tenant.example/meu-post');
    expect(input.publishedAt.toISOString()).toBe('2024-01-02T03:04:05.000Z');
    expect(input.updatedAt.toISOString()).toBe('2024-02-02T03:04:05.000Z');
  });
});

describe('wpPersonInput', () => {
  it('maps the author with the tenant-domain url', () => {
    const person = wpPersonInput(makePost(), 'https://tenant.example/author/hank');
    expect(person).not.toBeNull();
    expect(person!.name).toBe('Renato Mesquita');
    expect(person!.url).toBe('https://tenant.example/author/hank');
    expect(person!.bio).toBe('Bio');
  });

  it('returns null when the post has no author', () => {
    expect(wpPersonInput(makePost({ author: null }))).toBeNull();
  });
});

// Minimal tenant literal — buildArticleSchema only reads seo.organization.{name,url}.
const tenantStub = { seo: { organization: { name: 'T', url: 'https://tenant.example' } } } as any;

describe('wp-seo adapters feed seo.ts builders', () => {
  it('buildArticleSchema accepts wpArticleInput output', () => {
    const schema = buildArticleSchema(tenantStub, 'pt-br', wpArticleInput(makePost(), 'https://tenant.example/meu-post'));
    expect(schema['@type']).toBe('Article');
    expect((schema as any).headline).toBe('Meu Post');
  });
  it('buildPersonSchema accepts wpPersonInput output', () => {
    const schema = buildPersonSchema(wpPersonInput(makePost(), 'https://tenant.example/author/hank')!);
    expect(schema['@type']).toBe('Person');
  });
});
