import type { Quiz, Vertical, WeightedUrl } from './schemas';
import { findPost } from './content';
import { postPath } from './url';

/**
 * Resolved redirect configuration ready to be embedded into the page.
 *
 *  - `prefetchHrefs`: every URL the user might land on. Emitted as
 *    `<link rel="prefetch">` so the destination is cached before redirect.
 *  - `noscriptHref`: fallback `<a href>` shown for `<noscript>` users (sans JS).
 *    For routed/weighted, this is the most-weighted URL of the default bucket
 *    (or the post URL for `post`/`routed` types).
 *  - `runtime`: JSON serialized into a data-attribute for client JS to make
 *    the final pick at runtime (weighted random + answer-based rules).
 */
export interface ResolvedRedirect {
  prefetchHrefs: string[];
  noscriptHref: string;
  runtime: RedirectRuntime;
}

export type RedirectRuntime =
  | { type: 'post'; href: string }
  | {
      type: 'routed';
      rules: Array<{
        when: { questionKey: string; answerKey: string };
        href: string;
      }>;
      default: { href: string };
    }
  | { type: 'weighted'; urls: WeightedUrl[] }
  | {
      type: 'routed-external';
      rules: Array<{
        when: { questionKey: string; answerKey: string };
        urls: WeightedUrl[];
      }>;
      default: WeightedUrl[];
    };

function urlsHrefs(urls: WeightedUrl[]): string[] {
  return urls.map((u) => u.url);
}

function pickHeaviest(urls: WeightedUrl[]): string {
  return urls.reduce((heavy, u) => (u.weight > heavy.weight ? u : heavy), urls[0]).url;
}

// T1.5.B19 — Hard-fail the build when a quiz redirect points at a missing
// post. The previous silent fallback to the locale root (`/${locale}`) turned
// paid traffic into bounce traffic with zero error signal. This runs at SSG
// (every quiz page invokes resolveRedirect during getStaticPaths), so an
// authoring mistake surfaces in the next build instead of in production.
async function postSlugToHref(
  slug: string,
  locale: string,
  vertical: Vertical,
): Promise<string> {
  const entry = await findPost(locale, vertical, slug);
  if (!entry) {
    throw new Error(
      `Quiz redirect references missing post: locale="${locale}" vertical="${vertical}" slug="${slug}". ` +
        `Create the post or update resultRedirect in the quiz YAML.`,
    );
  }
  return postPath(locale, vertical, slug);
}

export async function resolveRedirect(
  quiz: Quiz,
  locale: string,
  vertical: Vertical,
): Promise<ResolvedRedirect> {
  const r = quiz.resultRedirect;

  if (r.type === 'post') {
    const href = await postSlugToHref(r.postSlug, locale, vertical);
    return {
      prefetchHrefs: [href],
      noscriptHref: href,
      runtime: { type: 'post', href },
    };
  }

  if (r.type === 'routed') {
    const resolvedRules = await Promise.all(
      r.rules.map(async (rule) => ({
        when: rule.when,
        href: await postSlugToHref(rule.postSlug, locale, vertical),
      })),
    );
    const defaultHref = await postSlugToHref(r.default.postSlug, locale, vertical);
    const allHrefs = Array.from(
      new Set([defaultHref, ...resolvedRules.map((rule) => rule.href)]),
    );
    return {
      prefetchHrefs: allHrefs,
      noscriptHref: defaultHref,
      runtime: {
        type: 'routed',
        rules: resolvedRules,
        default: { href: defaultHref },
      },
    };
  }

  if (r.type === 'weighted') {
    return {
      prefetchHrefs: urlsHrefs(r.urls),
      noscriptHref: pickHeaviest(r.urls),
      runtime: { type: 'weighted', urls: r.urls },
    };
  }

  // routed-external
  const allUrls = [...r.default, ...r.rules.flatMap((rule) => rule.urls)];
  return {
    prefetchHrefs: Array.from(new Set(urlsHrefs(allUrls))),
    noscriptHref: pickHeaviest(r.default),
    runtime: {
      type: 'routed-external',
      rules: r.rules.map((rule) => ({ when: rule.when, urls: rule.urls })),
      default: r.default,
    },
  };
}
