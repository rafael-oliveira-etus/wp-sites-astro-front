import type { WpPost } from './wp-types';

export interface WpArticleInput {
  title: string;
  description: string;
  url: string;
  image?: string;
  publishedAt: Date;
  updatedAt: Date;
  author: { name: string; url?: string };
}

export interface WpPersonInput {
  name: string;
  bio?: string;
  url?: string;
  avatar?: string;
}

export function wpArticleInput(post: WpPost, canonicalUrl: string, authorUrl?: string): WpArticleInput {
  return {
    title: post.title,
    description: post.yoast?.description ?? post.excerpt,
    url: canonicalUrl,
    image: post.yoast?.ogImage ?? post.featuredMedia?.sourceUrl,
    publishedAt: post.publishedAt,
    updatedAt: post.updatedAt,
    author: { name: post.author?.name ?? '', url: authorUrl },
  };
}

export function wpPersonInput(post: WpPost, authorUrl?: string): WpPersonInput | null {
  if (!post.author) return null;
  return {
    name: post.author.name,
    bio: post.author.bio || undefined,
    url: authorUrl,
    avatar: post.author.avatar,
  };
}
