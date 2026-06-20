import { type Tenant } from './schemas';
import { localeDisplay } from './tenant';
import { absoluteUrl } from './url';

export type OgType = 'website' | 'article' | 'profile' | 'video.other';

export interface SeoProps {
  title?: string;
  description?: string;
  image?: string;
  imageAlt?: string;
  imageType?: string;
  type?: OgType;
  canonical?: string;
  noindex?: boolean;
  publishedTime?: string;
  modifiedTime?: string;
  author?: string;
  keywords?: string[];
  schemas?: Record<string, unknown>[];
  alternates?: Array<{ hreflang: string; href: string }>;
}

// T1.5.H13 — Conditional-spread output to keep the JSON-LD lean. Google
// treats `sameAs: []` (empty array) as invalid and discards the entire
// `sameAs` claim; emit the property only when at least one URL is present.
// Same conditional logic for legalName / logo / contactPoint / address —
// omitted fields are dropped instead of stringified as `null`/`undefined`.
export function buildOrganizationSchema(tenant: Tenant): Record<string, unknown> | null {
  if (!tenant.seo) return null;
  const org = tenant.seo.organization;
  const out: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: org.name,
    url: org.url,
  };
  if (org.legalName) out.legalName = org.legalName;
  if (org.logo) out.logo = org.logo;
  if (org.sameAs && org.sameAs.length > 0) out.sameAs = org.sameAs;
  if (org.contactPoint) {
    out.contactPoint = {
      '@type': 'ContactPoint',
      ...org.contactPoint,
    };
  }
  if (org.address) {
    out.address = {
      '@type': 'PostalAddress',
      ...org.address,
    };
  }
  return out;
}

export function buildWebSiteSchema(
  tenant: Tenant,
  locale: string,
  siteName?: string,
): Record<string, unknown> {
  const display = localeDisplay(tenant, locale);
  const schema: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: siteName || display.siteName,
    url: absoluteUrl(tenant, `/${locale}`),
    inLanguage: locale,
  };
  if (tenant.seo) {
    schema.publisher = {
      '@type': 'Organization',
      name: tenant.seo.organization.name,
      url: tenant.seo.organization.url,
    };
  }
  return schema;
}

export function buildWebPageSchema(
  tenant: Tenant,
  locale: string,
  input: { title: string; description: string; url: string; image?: string; siteName?: string },
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: input.title,
    description: input.description,
    url: input.url,
    inLanguage: locale,
    primaryImageOfPage: input.image
      ? { '@type': 'ImageObject', url: input.image }
      : undefined,
    isPartOf: {
      '@type': 'WebSite',
      name: input.siteName || localeDisplay(tenant, locale).siteName,
      url: absoluteUrl(tenant, `/${locale}`),
    },
  };
}

export function buildBreadcrumbSchema(
  items: Array<{ name: string; url: string }>,
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export function buildFaqSchema(
  items: Array<{ question: string; answer: string }>,
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answer },
    })),
  };
}

export function buildArticleSchema(
  tenant: Tenant,
  locale: string,
  input: {
    title: string;
    description: string;
    url: string;
    image?: string;
    publishedAt: Date;
    updatedAt: Date;
    author: { name: string; url?: string };
  },
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: input.title,
    description: input.description,
    url: input.url,
    inLanguage: locale,
    image: input.image,
    datePublished: input.publishedAt.toISOString(),
    dateModified: input.updatedAt.toISOString(),
    author: {
      '@type': 'Person',
      name: input.author.name,
      url: input.author.url,
    },
    ...(tenant.seo ? {
      publisher: {
        '@type': 'Organization',
        name: tenant.seo.organization.name,
        url: tenant.seo.organization.url,
      },
    } : {}),
  };
}

// Person schema for a named reviewer (E-E-A-T). jobTitle/sameAs/description are
// the trust signals Google reads for YMYL author authority; omitted when empty.
export function buildPersonSchema(author: {
  name: string;
  title?: string;
  bio?: string;
  url?: string;
  avatar?: string;
  sameAs?: string[];
}): Record<string, unknown> {
  const out: Record<string, unknown> = { '@context': 'https://schema.org', '@type': 'Person', name: author.name };
  if (author.title) out.jobTitle = author.title;
  if (author.bio) out.description = author.bio;
  if (author.url) out.url = author.url;
  if (author.avatar) out.image = author.avatar;
  if (author.sameAs && author.sameAs.length > 0) out.sameAs = author.sameAs;
  return out;
}

export function buildQuizSchema(
  tenant: Tenant,
  locale: string,
  input: {
    title: string;
    description: string;
    url: string;
    numberOfQuestions: number;
  },
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Quiz',
    name: input.title,
    description: input.description,
    url: input.url,
    inLanguage: locale,
    numberOfQuestions: input.numberOfQuestions,
    ...(tenant.seo ? {
      provider: {
        '@type': 'Organization',
        name: tenant.seo.organization.name,
        url: tenant.seo.organization.url,
      },
    } : {}),
  };
}

export function inferImageType(path: string): string {
  if (path.endsWith('.svg')) return 'image/svg+xml';
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.webp')) return 'image/webp';
  if (path.endsWith('.avif')) return 'image/avif';
  return 'image/jpeg';
}
