export * from './jsonld.ts'
export type SiteMeta = {
  site: URL | string
  brand: string
  defaultOgImage?: string
  twitterHandle?: string
}
export type SeoProps = {
  title: string
  description: string
  canonical?: string | URL
  type?: 'website' | 'article'
  image?: string
  publishedAt?: Date | string
  updatedAt?: Date | string
  author?: { name: string; url?: string }
  noindex?: boolean
}
