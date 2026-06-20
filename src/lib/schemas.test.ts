import { describe, expect, it } from 'vitest';
import { tenantSchema, DEFAULT_BRAND } from './schemas';

const baseTenant = {
  id: 'examplecards',
  domains: ['example.com'],
  defaultLocale: 'en-us',
  locales: ['en-us'],
  theme: 'classic',
  brand: {
    primaryColor: '#0c03eb',
    secondaryColor: '#0f172a',
    bgColor: '#f1f4f7',
    textColor: '#1f2937',
    mutedTextColor: '#555851',
  },
  seo: {
    twitterHandle: '@examplecards',
    organization: {
      name: 'ExampleCards',
      url: 'https://example.com',
    },
  },
  display: {
    'en-us': {
      siteName: 'ExampleCards',
      siteShortName: 'ExampleCards',
      tagline: 'Find out the best credit card for you now!',
      description:
        'Your new card is less than 30 seconds away. Answer 2-3 quick questions and get a personalized recommendation.',
      verticals: {
        cc: 'Credit Cards',
        loans: 'Loans',
        insurance: 'Insurance',
        education: 'Financial Education',
      },
      nav: {
        blog: 'Blog',
        home: 'Home',
      },
      legalConsent: 'I agree to the terms and conditions.',
      ui: {
        skipLink: 'Skip to main content',
        sponsored: 'Sponsored',
        adLabel: 'Advertisement',
        by: 'By',
        minRead: 'min read',
        continueLabel: 'Continue',
        relatedPosts: 'Related articles',
        breadcrumbAria: 'Breadcrumb',
        primaryNavAria: 'Primary',
        progressAria: 'Quiz progress',
        languageNavAria: 'Language',
        noPostsYet: 'No articles yet — check back soon.',
        back: 'Back',
        onThisPage: 'On this page',
        share: 'Share',
        copyLink: 'Copy link',
        linkCopied: 'Link copied',
        prevPage: 'Previous',
        nextPage: 'Next',
        reviewedBy: 'Reviewed by',
      },
      notFound: {
        heading: 'Page not found',
        subheading: 'The page you are looking for does not exist.',
        cta: 'Go back home',
      },
      noscript: {
        quiz: 'JavaScript is required to run this quiz.',
        capture: 'JavaScript is required to submit the form.',
      },
    },
  },
  tracking: {
    eventsApiUrl: '',
    writeKey: '',
    turnstile: { enabled: false, siteKey: '' },
    meta: { pixels: [] },
    tiktok: { pixels: [] },
    googleAds: { accounts: [] },
    ga4: { properties: [] },
    microsoftUet: { tags: [] },
  },
};

describe('tenantSchema minimal bootstrap', () => {
  const minimal = {
    id: 'cardfacil',
    domains: ['cardfacil.com'],
    defaultLocale: 'pt-br',
    locales: ['pt-br'],
    wpAuthEnv: 'WP_AUTH_CARDFACIL',
    blog: { wpBaseUrl: 'https://cardfacil.com' },
  };

  it('parses a minimal tenant with no display/seo/legal', () => {
    const t = tenantSchema.parse(minimal);
    expect(t.id).toBe('cardfacil');
    expect(t.display).toBeUndefined();
    expect(t.seo).toBeUndefined();
    expect(t.legal).toBeUndefined();
    expect(t.wpAuthEnv).toBe('WP_AUTH_CARDFACIL');
  });

  it('defaults brand to DEFAULT_BRAND when omitted', () => {
    const t = tenantSchema.parse(minimal);
    expect(t.brand).toEqual(DEFAULT_BRAND);
  });

  it('keeps wpAuthEnv optional', () => {
    const { wpAuthEnv, ...noAuth } = minimal;
    const t = tenantSchema.parse(noAuth);
    expect(t.wpAuthEnv).toBeUndefined();
  });
});

describe('tenantSchema.blog', () => {
  it('accepts a tenant with blog.wpBaseUrl', () => {
    const parsed = tenantSchema.parse({ ...baseTenant, blog: { wpBaseUrl: 'https://limitemais.com' } });
    expect(parsed.blog?.wpBaseUrl).toBe('https://limitemais.com');
  });

  it('leaves blog undefined when omitted (YAML-mode tenant)', () => {
    const parsed = tenantSchema.parse(baseTenant);
    expect(parsed.blog).toBeUndefined();
  });

  it('rejects a non-URL wpBaseUrl', () => {
    expect(() => tenantSchema.parse({ ...baseTenant, blog: { wpBaseUrl: 'not-a-url' } })).toThrow();
  });
});
