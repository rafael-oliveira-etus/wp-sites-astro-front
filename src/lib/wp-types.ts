export interface WpAuthor {
  id: number;
  name: string;
  slug: string;
  link: string;
  bio: string;
  avatar?: string;
}

export interface WpMedia {
  sourceUrl: string;
  width?: number;
  height?: number;
  alt: string;
  srcset?: Array<{ url: string; width: number }>;
}

export interface WpTerm {
  id: number;
  slug: string;
  name: string;
  taxonomy: string;
  link: string;
}

export interface WpYoast {
  title?: string;
  description?: string;
  canonical?: string;
  robots?: Record<string, string>;
  ogImage?: string;
  articlePublishedTime?: string;
  articleModifiedTime?: string;
}

export interface WpPost {
  id: number;
  slug: string;
  link: string;
  title: string;
  /** Optional `post_subtitle` custom field (registered post meta). '' when unset. */
  subtitle?: string;
  excerpt: string;
  contentHtml: string;
  publishedAt: Date;
  updatedAt: Date;
  author: WpAuthor | null;
  featuredMedia: WpMedia | null;
  terms: WpTerm[];
  yoast: WpYoast | null;
}
