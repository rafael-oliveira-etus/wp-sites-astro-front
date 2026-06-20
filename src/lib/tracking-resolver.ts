// Multi-pixel matrix resolver (T2.9-T2.30).
//
// A tenant declares N pixels per channel (Meta / TikTok / Google Ads / GA4 /
// Microsoft UET) with optional overrides keyed by vertical, locale, or both.
// Resolution is additive: at runtime we union the base list + per-vertical +
// per-locale + per-vertical-locale, dedupe by id, and hand the merged list to
// the fan-out layer.
//
// The same logic lives twice — here (frontend, used by AnalyticsBoot to
// configure the client-side pixel loader) and in events-api (used by ingest
// to drive server-side CAPI fan-out). The two implementations are kept
// behaviorally identical; if you change resolution semantics, change both.

import type {
  GA4Property,
  GoogleAdsAccount,
  MetaPixel,
  MicrosoftUetTag,
  TenantTracking,
  TikTokPixel,
  Vertical,
} from './schemas';

interface ChannelMatrix<TItem, K extends string> {
  pixels?: TItem[];
  accounts?: TItem[];
  properties?: TItem[];
  tags?: TItem[];
  byVertical?: Record<string, Partial<Record<K, TItem[]>>>;
  byLocale?: Record<string, Partial<Record<K, TItem[]>>>;
  byVerticalLocale?: Record<string, Partial<Record<K, TItem[]>>>;
}

function mergeChannel<TItem extends { id?: string; conversionId?: string; measurementId?: string; tagId?: string }, K extends 'pixels' | 'accounts' | 'properties' | 'tags'>(
  channel: ChannelMatrix<TItem, K> | undefined,
  vertical: Vertical | null,
  locale: string | null,
  listKey: K,
): TItem[] {
  if (!channel) return [];
  const base = (channel[listKey] as TItem[] | undefined) ?? [];
  const v = vertical ? (channel.byVertical?.[vertical]?.[listKey] ?? []) : [];
  const l = locale ? (channel.byLocale?.[locale]?.[listKey] ?? []) : [];
  const vl =
    vertical && locale
      ? (channel.byVerticalLocale?.[`${vertical}/${locale}`]?.[listKey] ?? [])
      : [];
  const merged = [...base, ...v, ...l, ...vl];
  const seen = new Set<string>();
  return merged.filter((item) => {
    const id =
      item.id ?? item.conversionId ?? item.measurementId ?? item.tagId ?? '';
    if (!id) return false;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function resolveMetaPixels(
  tracking: TenantTracking,
  vertical: Vertical | null,
  locale: string | null,
): MetaPixel[] {
  return mergeChannel<MetaPixel, 'pixels'>(
    tracking.meta as unknown as ChannelMatrix<MetaPixel, 'pixels'>,
    vertical,
    locale,
    'pixels',
  );
}

export function resolveTikTokPixels(
  tracking: TenantTracking,
  vertical: Vertical | null,
  locale: string | null,
): TikTokPixel[] {
  return mergeChannel<TikTokPixel, 'pixels'>(
    tracking.tiktok as unknown as ChannelMatrix<TikTokPixel, 'pixels'>,
    vertical,
    locale,
    'pixels',
  );
}

export function resolveGoogleAdsAccounts(
  tracking: TenantTracking,
  vertical: Vertical | null,
  locale: string | null,
): GoogleAdsAccount[] {
  return mergeChannel<GoogleAdsAccount, 'accounts'>(
    tracking.googleAds as unknown as ChannelMatrix<GoogleAdsAccount, 'accounts'>,
    vertical,
    locale,
    'accounts',
  );
}

export function resolveGA4Properties(
  tracking: TenantTracking,
  vertical: Vertical | null,
  locale: string | null,
): GA4Property[] {
  return mergeChannel<GA4Property, 'properties'>(
    tracking.ga4 as unknown as ChannelMatrix<GA4Property, 'properties'>,
    vertical,
    locale,
    'properties',
  );
}

export function resolveMicrosoftUetTags(
  tracking: TenantTracking,
  vertical: Vertical | null,
  locale: string | null,
): MicrosoftUetTag[] {
  return mergeChannel<MicrosoftUetTag, 'tags'>(
    tracking.microsoftUet as unknown as ChannelMatrix<MicrosoftUetTag, 'tags'>,
    vertical,
    locale,
    'tags',
  );
}

/**
 * Shape passed to the client-side pixel loader. Pre-resolved at SSG time so the
 * client doesn't ship the whole matrix — only the pixels relevant to the
 * current page.
 */
export interface ResolvedPixels {
  meta: MetaPixel[];
  tiktok: TikTokPixel[];
  googleAds: GoogleAdsAccount[];
  ga4: GA4Property[];
  microsoftUet: MicrosoftUetTag[];
}

export function resolveAllPixels(
  tracking: TenantTracking,
  vertical: Vertical | null,
  locale: string | null,
): ResolvedPixels {
  return {
    meta: resolveMetaPixels(tracking, vertical, locale),
    tiktok: resolveTikTokPixels(tracking, vertical, locale),
    googleAds: resolveGoogleAdsAccounts(tracking, vertical, locale),
    ga4: resolveGA4Properties(tracking, vertical, locale),
    microsoftUet: resolveMicrosoftUetTags(tracking, vertical, locale),
  };
}

export function hasAnyPixel(p: ResolvedPixels): boolean {
  return (
    p.meta.length > 0 ||
    p.tiktok.length > 0 ||
    p.googleAds.length > 0 ||
    p.ga4.length > 0 ||
    p.microsoftUet.length > 0
  );
}
