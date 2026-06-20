/** Build JSON-LD payloads (schema.org). Strict, no extra fields. */
import type { SeoProps, SiteMeta } from './index.ts'

export function articleJsonLd(site: SiteMeta, p: SeoProps): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: p.title,
    description: p.description,
    image: p.image ? [String(p.image)] : undefined,
    datePublished: p.publishedAt ? new Date(p.publishedAt).toISOString() : undefined,
    dateModified: p.updatedAt ? new Date(p.updatedAt).toISOString() : undefined,
    author: p.author ? { '@type': 'Person', name: p.author.name, url: p.author.url } : undefined,
    publisher: { '@type': 'Organization', name: site.brand },
    mainEntityOfPage: { '@type': 'WebPage', '@id': String(p.canonical ?? site.site) },
  }
}

export function websiteJsonLd(site: SiteMeta): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: site.brand,
    url: String(site.site),
  }
}

export function breadcrumbsJsonLd(items: Array<{ name: string; url: string }>): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: it.url,
    })),
  }
}
