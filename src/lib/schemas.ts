import { z } from 'zod';
import type { AdPlacement, AdsSiteConfig } from '@etus/ads';

export const VERTICALS = ['cc', 'loans', 'insurance', 'education'] as const;
export const verticalSchema = z.enum(VERTICALS);
export type Vertical = z.infer<typeof verticalSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Multi-pixel tracking matrix (T2.9-T2.30, programmatic-media finance vertical).
//
// One tenant runs N pixels per channel, possibly differentiated by vertical
// (cc/loans/insurance), locale (es-ar/es-cl), or both. Resolution is additive:
// the runtime merges base + byVertical + byLocale + byVerticalLocale and
// deduplicates by id. Secrets (access tokens, API secrets) never live in
// tenant.yaml — only IDs do; tokens are wrangler secrets in events-api keyed
// by the same id.
// ─────────────────────────────────────────────────────────────────────────────

const metaPixelSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  // Per-pixel test_event_code; ignored unless ENVIRONMENT=staging at the worker.
  testEventCode: z.string().optional(),
});
const tiktokPixelSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
});
const googleAdsAccountSchema = z.object({
  // gtag-style `AW-1234567890`. Required for conversion lookup.
  conversionId: z.string().regex(/^AW-\d+$/, 'conversionId must look like AW-1234567890'),
  // 12-char label assigned to the conversion action in Google Ads UI.
  conversionLabel: z.string().min(1),
  name: z.string().optional(),
});
const ga4PropertySchema = z.object({
  // Property measurement ID `G-XXXXXXXXXX`.
  measurementId: z.string().regex(/^G-[A-Z0-9]+$/, 'measurementId must look like G-XXXXXXXXXX'),
  name: z.string().optional(),
});
const microsoftUetTagSchema = z.object({
  // UET tag ID (numeric, Bing-issued).
  tagId: z.string().regex(/^\d+$/, 'tagId must be numeric'),
  name: z.string().optional(),
});

export type MetaPixel = z.infer<typeof metaPixelSchema>;
export type TikTokPixel = z.infer<typeof tiktokPixelSchema>;
export type GoogleAdsAccount = z.infer<typeof googleAdsAccountSchema>;
export type GA4Property = z.infer<typeof ga4PropertySchema>;
export type MicrosoftUetTag = z.infer<typeof microsoftUetTagSchema>;

const verticalKey = z.enum(VERTICALS);
const verticalLocaleKey = z
  .string()
  .regex(
    new RegExp(`^(${VERTICALS.join('|')})/[a-z]{2}-[a-z]{2}$`),
    'byVerticalLocale key must be like "cc/en-us"',
  );

// Generic channel container factory — same shape for every destination, only
// the leaf list field name differs (pixels/accounts/properties/tags).
function channelSchema<TItem extends z.ZodTypeAny, K extends string>(
  itemSchema: TItem,
  listKey: K,
) {
  const list = z.array(itemSchema).default([]);
  const localeKey = z
    .string()
    .regex(/^[a-z]{2}-[a-z]{2}$/, 'locale key must be like "en-us"');
  const branch = z.object({ [listKey]: list } as Record<K, typeof list>);
  const channel = z.object({
    [listKey]: list,
    byVertical: z.record(verticalKey, branch).optional(),
    byLocale: z.record(localeKey, branch).optional(),
    byVerticalLocale: z.record(verticalLocaleKey, branch).optional(),
  });
  // Zod 4's `.default()` expects the schema's output type (not Record<string,unknown>,
  // whose `unknown` values don't satisfy the typed list field). Cast the literal
  // default through it — runtime value is unchanged: `{ [listKey]: [] }`.
  return channel.default({ [listKey]: [] } as unknown as z.infer<typeof channel>);
}

const metaChannelSchema = channelSchema(metaPixelSchema, 'pixels');
const tiktokChannelSchema = channelSchema(tiktokPixelSchema, 'pixels');
const googleAdsChannelSchema = channelSchema(googleAdsAccountSchema, 'accounts');
const ga4ChannelSchema = channelSchema(ga4PropertySchema, 'properties');
const microsoftUetChannelSchema = channelSchema(microsoftUetTagSchema, 'tags');

export type MetaChannel = z.infer<typeof metaChannelSchema>;
export type TikTokChannel = z.infer<typeof tiktokChannelSchema>;
export type GoogleAdsChannel = z.infer<typeof googleAdsChannelSchema>;
export type GA4Channel = z.infer<typeof ga4ChannelSchema>;
export type MicrosoftUetChannel = z.infer<typeof microsoftUetChannelSchema>;

export const trackingSchema = z
  .object({
    // URL of the events-api worker (no trailing slash). Empty = same-origin
    // (Worker Route per tenant domain — T0.1). Build-time env override:
    // PUBLIC_EVENTS_API_URL (dev defaults to http://localhost:8787).
    eventsApiUrl: z.string().default(''),
    // Per-tenant write key. Authorization: Bearer. Override via
    // PUBLIC_EVENTS_WRITE_KEY at build time.
    writeKey: z.string().default(''),
    // Cloudflare Turnstile — invisible bot challenge on form submit.
    turnstile: z
      .object({
        enabled: z.boolean().default(false),
        siteKey: z.string().default(''),
      })
      .default({ enabled: false, siteKey: '' }),
    // Per-channel matrix. Each channel may declare a base list plus
    // overrides keyed by vertical / locale / "vertical/locale". Resolution
    // unions all matching layers and deduplicates by id.
    meta: metaChannelSchema,
    tiktok: tiktokChannelSchema,
    googleAds: googleAdsChannelSchema,
    ga4: ga4ChannelSchema,
    microsoftUet: microsoftUetChannelSchema,
  })
  .default({
    eventsApiUrl: '',
    writeKey: '',
    turnstile: { enabled: false, siteKey: '' },
    meta: { pixels: [] },
    tiktok: { pixels: [] },
    googleAds: { accounts: [] },
    ga4: { properties: [] },
    microsoftUet: { tags: [] },
  });

export type TenantTracking = z.infer<typeof trackingSchema>;

const localeStringSchema = z
  .string()
  .regex(/^[a-z]{2}-[a-z]{2}$/, 'locale must be lowercase BCP 47 like "en-us"');

export const localeDisplaySchema = z.object({
  siteName: z.string(),
  siteShortName: z.string(),
  tagline: z.string(),
  description: z.string(),
  verticals: z.record(verticalSchema, z.string()),
  nav: z.object({
    blog: z.string(),
    home: z.string(),
  }),
  legalConsent: z.string(),
  ui: z.object({
    skipLink: z.string(),
    sponsored: z.string(),
    by: z.string(),
    minRead: z.string(),
    continueLabel: z.string(),
    relatedPosts: z.string(),
    breadcrumbAria: z.string(),
    primaryNavAria: z.string(),
    progressAria: z.string(),
    languageNavAria: z.string(),
    noPostsYet: z.string(),
    back: z.string(),
    // Blog reader UI (Phase D). Defaults keep older tenant.yaml parsing while
    // each tenant supplies localized copy.
    onThisPage: z.string().default('On this page'),
    share: z.string().default('Share'),
    copyLink: z.string().default('Copy link'),
    linkCopied: z.string().default('Link copied'),
    prevPage: z.string().default('Previous'),
    nextPage: z.string().default('Next'),
    pageLabel: z.string().default('Page'),
    paginationAria: z.string().default('Pagination'),
    reviewedBy: z.string().default('Reviewed by'),
    // Editorial theme (Phase D) — defaulted so older tenant.yaml still parses;
    // tenants localize later.
    keyTakeaways: z.string().default('Key takeaways'),
    faqHeading: z.string().default('Frequently asked questions'),
    editorsPick: z.string().default("Editor's pick"),
    affiliateDisclosure: z
      .string()
      .default(
        'We may earn a commission from our partners. It does not affect our recommendations.',
      ),
    // Ad placeholder label (AdZone). CSS uppercases it → ADVERTISEMENT / PUBLICIDAD.
    // From the DXP wrapper's locale default; defaulted so older tenant.yaml parses.
    adLabel: z.string().default('Advertisement'),
    // Mobile hamburger toggle aria-label (headless blog header). Optional+default
    // so existing tenant YAML keeps parsing; tenants localize as needed.
    menuToggle: z.string().default('Menu'),
  }),
  notFound: z.object({
    heading: z.string(),
    subheading: z.string(),
    cta: z.string(),
  }),
  noscript: z.object({
    quiz: z.string(),
    capture: z.string(),
  }),
  webpush: z
    .object({
      headline: z.string(),
      body: z.string(),
      acceptLabel: z.string(),
      declineLabel: z.string(),
    })
    .optional(),
  footer: z
    .object({
      // Top row of links (terms, privacy, about). Renders only if non-empty.
      links: z
        .array(z.object({ label: z.string(), href: z.string() }))
        .default([]),
      // Label that prefixes contact info (e.g. "Contact", "Contato", "Contacto").
      contactLabel: z.string().default('Contact'),
      // Free-form localized legal disclosure paragraph. Rendered as plain text
      // with `white-space: pre-line` so newlines are honored. Tenants embed
      // jurisdiction-specific disclosures (APR ranges, affiliate disclaimer,
      // LGPD/GDPR/CCPA, operator entity info).
      disclosure: z.string().optional(),
    })
    .optional(),
  // T1.11 — Consent Mode v2 banner copy per locale. Optional: if absent,
  // banner falls back to baked-in English defaults. Required for EEA/UK/CH/BR.
  consent: z
    .object({
      headline: z.string(),
      body: z.string(),
      acceptAllLabel: z.string(),
      rejectAllLabel: z.string(),
      settingsLabel: z.string().optional(),
      privacyPolicyHref: z.string().optional(),
      privacyPolicyLabel: z.string().optional(),
    })
    .optional(),
});

export type LocaleDisplay = z.infer<typeof localeDisplaySchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Ads (Phase C): Zod mirror of @etus/ads `AdsSiteConfig` + `AdPlacement`. Keep
// field-for-field with packages/ads/src/{types,registry/plan}.ts — the
// three-contract-layers rule. The drift-guards below fail the BUILD if the Zod
// shape stops being assignable to the engine types. (Rare fields — `tier`,
// `strategy`, `pps`, `secureSignalProviders` — are intentionally omitted; they're
// optional + default in code, and omitting keeps the Zod type assignable.)
const sizingSchema = z.union([z.tuple([z.number(), z.number()]), z.literal('fluid')]);
const sizeMapSchema = z.record(z.string(), z.array(sizingSchema));
const reserveMapSchema = z.record(z.string(), z.number());
const refreshConfigSchema = z.object({
  intervalSec: z.number().optional(),
  minViewablePct: z.number().optional(),
  cap: z.number().optional(),
});
const deviceClassSchema = z.enum(['mobile', 'tablet', 'desktop']);
const placementPositionSchema = z.enum([
  'before-content', 'after-content', 'before-paragraph', 'after-paragraph',
  'anchor', 'siderail-left', 'siderail-right', 'interstitial',
]);
const adPlacementTypeSchema = z.enum([
  'top-banner', 'hero', 'in-content', 'sidebar', 'sticky-sidebar', 'sticky-footer',
  'anchor', 'interstitial', 'rewarded',
]);
const placementWhereSchema = z.object({
  collections: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  minParagraphs: z.number().optional(),
  minWords: z.number().optional(),
});

export const adsSiteConfigSchema = z.object({
  networkCode: z.string(),
  testNetworkCode: z.string().optional(),
  mcmManagerPubId: z.string().optional(),
  mcmManagerDomain: z.string().optional(),
  singleRequest: z.boolean().optional(),
  lazyLoad: z
    .object({
      fetchMarginPercent: z.number().optional(),
      renderMarginPercent: z.number().optional(),
      mobileScaling: z.number().optional(),
    })
    .optional(),
  collapseDiv: z.enum(['DISABLED', 'BEFORE_FETCH', 'ON_NO_FILL']).optional(),
  enablePpid: z.boolean().optional(),
  // URL query-param names forwarded to GAM as page-level key-values at render.
  // From the wrapper's customTargeting urlParam passthrough (utm_*). Mirrors
  // AdsSiteConfig.urlTargetingKeys — the drift guard enforces field-parity.
  urlTargetingKeys: z.array(z.string()).optional(),
  forceNpa: z.boolean().optional(),
  tagForAgeTreatment: z.enum(['UNSPECIFIED', 'CHILD', 'TEEN']).optional(),
});

export const adPlacementSchema = z.object({
  id: z.string(),
  type: adPlacementTypeSchema,
  enabled: z.boolean(),
  adUnit: z.string(),
  position: placementPositionSchema.optional(),
  index: z.union([z.number(), z.array(z.number())]).optional(),
  every: z.number().optional(),
  maxPerPost: z.number().optional(),
  devices: z.array(deviceClassSchema).optional(),
  sizes: sizeMapSchema.optional(),
  reserve: reserveMapSchema.optional(),
  refresh: z.union([z.boolean(), refreshConfigSchema]).optional(),
  targeting: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
  where: placementWhereSchema.optional(),
});

// Build-time drift guards: Zod-inferred types MUST stay assignable to the engine types.
type _AssertAdsSite = z.infer<typeof adsSiteConfigSchema> extends AdsSiteConfig ? true : ['DRIFT: adsSiteConfigSchema vs AdsSiteConfig'];
type _AssertPlacement = z.infer<typeof adPlacementSchema> extends AdPlacement ? true : ['DRIFT: adPlacementSchema vs AdPlacement'];
const _assertAdsSite: _AssertAdsSite = true;
const _assertPlacement: _AssertPlacement = true;
void _assertAdsSite;
void _assertPlacement;

export const blogConfigSchema = z.object({
  /** WordPress REST API origin, e.g. https://limitemais.com. _embed is appended by the client. */
  wpBaseUrl: z.url(),
  /** WP nav-menu theme-location slugs to render in the app's header/footer.
   *  Optional — the header/footer also try common defaults (primary/footer/…). */
  menus: z
    .object({
      header: z.string().optional(),
      footer: z.string().optional(),
    })
    .optional(),
});
export type BlogConfig = z.infer<typeof blogConfigSchema>;

export const tenantSchema = z.object({
  id: z.string().min(1),
  domains: z.array(z.string()).min(1),
  defaultLocale: localeStringSchema,
  locales: z.array(localeStringSchema).min(1),
  // Blog theme (Phase D). 'classic' = the original layout (A/B baseline);
  // 'editorial' = the premium reading-lane redesign. One Worker per tenant, so
  // this is constant per site — flip a tenant to compare against a classic one.
  theme: z.enum(['classic', 'editorial']).default('classic'),
  // Per-site ad-unit name prefix (e.g. "gat" for GotAllCards). Editorial ad slots
  // are named `<prefix>_<device>_<position>` — gat_mob_top, gat_desk_top,
  // gat_tablet_top, gat_mob_content, gat_desk_end, … Defaults to the tenant id.
  adUnitPrefix: z.string().optional(),
  brand: z.object({
    primaryColor: z.string(),
    secondaryColor: z.string(),
    bgColor: z.string(),
    textColor: z.string(),
    mutedTextColor: z.string(),
    logo: z
      .object({
        src: z.string().default('logo.svg'),
        width: z.number().int().positive().default(119),
        height: z.number().int().positive().default(31),
      })
      .default({ src: 'logo.svg', width: 119, height: 31 }),
  }),
  seo: z.object({
    twitterHandle: z.string(),
    organization: z.object({
      name: z.string(),
      legalName: z.string().optional(),
      url: z.url(),
      logo: z.url().optional(),
      sameAs: z.array(z.url()).default([]),
      // T1.5.H13 — Schema.org `contactPoint` + `address` populate Google's
      // Knowledge Panel and reduce trust friction on finance-vertical SERPs.
      // Both optional; omitted entries are dropped from the emitted JSON-LD.
      contactPoint: z
        .object({
          telephone: z.string().optional(),
          email: z.email().optional(),
          contactType: z.string().default('customer support'),
          areaServed: z.union([z.string(), z.array(z.string())]).optional(),
          availableLanguage: z.union([z.string(), z.array(z.string())]).optional(),
        })
        .optional(),
      address: z
        .object({
          streetAddress: z.string().optional(),
          addressLocality: z.string().optional(),
          addressRegion: z.string().optional(),
          postalCode: z.string().optional(),
          addressCountry: z.string(),
        })
        .optional(),
    }),
  }),
  display: z.record(localeStringSchema, localeDisplaySchema),
  // Per-tenant editorial identity (byline + future Person JSON-LD / author pages).
  // The content importer sources this instead of a hardcoded per-post WP author.
  editorial: z
    .object({ name: z.string(), bio: z.string().default(''), url: z.url().optional() })
    .optional(),
  // Named expert reviewers (E-E-A-T / YMYL). `authors` keyed by id; `authorByVertical`
  // assigns the reviewer per global vertical. Render shows "Reviewed by <name>" +
  // Person JSON-LD (sameAs) and falls back to `editorial` when a vertical is unmapped.
  authors: z
    .record(
      z.string(),
      z.object({
        name: z.string(),
        title: z.string().default(''),
        bio: z.string().default(''),
        avatar: z.string().optional(),
        url: z.url().optional(),
        sameAs: z.array(z.url()).default([]),
      }),
    )
    .default({}),
  authorByVertical: z.partialRecord(verticalSchema, z.string()).default({}),
  tracking: trackingSchema,
  crm: z
    .object({ endpoint: z.string().default('') })
    .default({ endpoint: '' }),
  webpush: z
    .object({
      enabled: z.boolean().default(false),
      delaySeconds: z.number().int().nonnegative().default(8),
      requestPermissionOnAccept: z.boolean().default(false),
    })
    .default({ enabled: false, delaySeconds: 8, requestPermissionOnAccept: false }),
  // Legal / KYC data required to run programmatic ads in regulated verticals
  // (finance, insurance, health). Without this, Google Ads / Meta Ads reject
  // affiliate landing pages. Schema is intentionally generic — works for
  // BR (CNPJ), AR (CUIT), US (EIN), EU (VAT), etc.
  legal: z
    .object({
      company: z.object({
        name: z.string(),
        taxIdLabel: z.string().default('Tax ID'),
        taxId: z.string(),
        address: z.string(),
        contactEmail: z.string(),
        contactPhone: z.string().optional(),
      }),
      // The legal entity that operates the platform. Often the same as company,
      // but split when the brand is operated by a holding (utua → Be Growth).
      operator: z
        .object({
          name: z.string(),
          taxIdLabel: z.string().default('Tax ID'),
          taxId: z.string(),
          address: z.string().optional(),
          contactEmail: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
  // Per-tenant ad config (Phase C). AdsSiteConfig (GAM network/MCM/lazyLoad/PPID)
  // + the declarative placement rules the engine resolves. Optional — blog/ads is
  // opt-in per tenant; absent = no ads. Real placement rows are filled per the
  // AdOps study (Phase E / account-side).
  ads: adsSiteConfigSchema
    .extend({ placements: z.array(adPlacementSchema).default([]) })
    .optional(),
  blog: blogConfigSchema.optional(),
});

export type Tenant = z.infer<typeof tenantSchema>;

export const quizStepSchema = z.object({
  id: z.string().min(1),
  question: z.string(),
  options: z
    .array(
      z.object({
        label: z.string(),
        value: z.string(),
        next: z.string().optional(),
      }),
    )
    .min(2),
});

export const quizFieldSchema = z.object({
  enabled: z.boolean().default(true),
  label: z.string(),
  placeholder: z.string().optional(),
  required: z.boolean().default(true),
});

export const captureSchema = z.object({
  headline: z.string(),
  subheadline: z.string(),
  submitLabel: z.string(),
  privacyNote: z.string(),
  fields: z.object({
    name: quizFieldSchema,
    email: quizFieldSchema,
    phone: quizFieldSchema,
  }),
});

export type QuizCapture = z.infer<typeof captureSchema>;

const weightedUrlSchema = z.object({
  url: z.url(),
  weight: z.number().int().min(1),
});
export type WeightedUrl = z.infer<typeof weightedUrlSchema>;

const ruleWhenSchema = z.object({
  questionKey: z.string(),
  answerKey: z.string(),
});

// Rule that routes to an internal blog post by slug.
const routedPostRuleSchema = z.object({
  when: ruleWhenSchema,
  postSlug: z.string(),
});
export type RoutedPostRule = z.infer<typeof routedPostRuleSchema>;

// Rule that routes to one of several external URLs (weighted).
const routedExternalRuleSchema = z.object({
  when: ruleWhenSchema,
  urls: z.array(weightedUrlSchema).min(1),
});
export type RoutedExternalRule = z.infer<typeof routedExternalRuleSchema>;

// T1.5.H12 — `(questionKey, answerKey)` tuples must be unique within a rule
// list. The runtime picker short-circuits on first match, so a duplicate
// silently shadows the later rule and the build emits no warning. Surface
// the conflict as a Zod parse error at content load.
function uniqueWhenTuples<T extends { when: { questionKey: string; answerKey: string } }>(
  rules: T[],
): boolean {
  const seen = new Set<string>();
  for (const r of rules) {
    const key = r.when.questionKey + ' ' + r.when.answerKey;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

const uniqueRulesError = {
  message:
    'routed rules must have unique (questionKey, answerKey) tuples — duplicates would silently shadow later rules',
  path: ['rules'] as PropertyKey[],
};

export const resultRedirectSchema = z.discriminatedUnion('type', [
  // Single internal post (no branching).
  z.object({
    type: z.literal('post'),
    postSlug: z.string(),
  }),
  // Brief-default: engine picks INTERNAL post based on quiz answers.
  z.object({
    type: z.literal('routed'),
    rules: z.array(routedPostRuleSchema).min(1),
    default: z.object({ postSlug: z.string() }),
  }).refine((d) => uniqueWhenTuples(d.rules), uniqueRulesError),
  // Special case: skip blog, redirect straight to external URL (weighted split).
  z.object({
    type: z.literal('weighted'),
    urls: z.array(weightedUrlSchema).min(1),
  }),
  // Special case: skip blog, route to external URL by answer (a quiz answer that links out).
  z.object({
    type: z.literal('routed-external'),
    rules: z.array(routedExternalRuleSchema).min(1),
    default: z.array(weightedUrlSchema).min(1),
  }).refine((d) => uniqueWhenTuples(d.rules), uniqueRulesError),
]);

export type QuizResultRedirect = z.infer<typeof resultRedirectSchema>;

export const quizModeSchema = z.enum(['spa', 'multipage']).default('multipage');
export type QuizMode = z.infer<typeof quizModeSchema>;

export const quizSchema = z.object({
  slug: z.string(),
  vertical: verticalSchema,
  title: z.string(),
  description: z.string(),
  seoTitle: z.string().optional(),
  ogImage: z.string().optional(),
  publishedAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  mode: quizModeSchema,
  resultRedirect: resultRedirectSchema,
  equivalents: z.record(localeStringSchema, z.string()).default({}),
  steps: z.array(quizStepSchema).min(1),
  capture: captureSchema.optional(),
});

export type Quiz = z.infer<typeof quizSchema>;
export type QuizStep = z.infer<typeof quizStepSchema>;

export const postSchema = z.object({
  slug: z.string(),
  vertical: verticalSchema,
  title: z.string(),
  description: z.string(),
  seoTitle: z.string().optional(),
  publishedAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  readingTimeMinutes: z.number().positive(),
  // Optional per-post author override (P7). When absent, render resolves the
  // named reviewer by vertical (tenant.authorByVertical) → editorial.
  author: z
    .object({
      name: z.string(),
      bio: z.string().default(''),
      url: z.string().optional(),
    })
    .optional(),
  ogImage: z.string().optional(),
  exitLink: z.object({
    url: z.url(),
    label: z.string(),
  }),
  relatedSlugs: z.array(z.string()).default([]),
  equivalents: z.record(localeStringSchema, z.string()).default({}),
  tags: z.array(z.string()).default([]),
  // Editorial theme (Phase D). Additive + defaulted so existing posts parse
  // unchanged; rendered only by the editorial theme and only when non-empty.
  // `keyTakeaways` → answer-first briefing box (GEO/AI-citation); `faq` →
  // disclosure list + FAQPage JSON-LD.
  keyTakeaways: z.array(z.string()).default([]),
  faq: z.array(z.object({ q: z.string(), a: z.string() })).default([]),
  content: z.string(),
});

export type Post = z.infer<typeof postSchema>;
