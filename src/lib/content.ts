import { getCollection, type CollectionEntry } from 'astro:content';
import { type Vertical } from './schemas';

interface ParsedId {
  locale: string;
  vertical: Vertical;
  slug: string;
}

function parseFilePath(filePath: string | undefined): ParsedId {
  if (!filePath) {
    throw new Error('Content entry has no filePath; cannot derive locale/vertical/slug.');
  }
  // filePath like ".../tenants/<id>/content/<locale>/<section>/<vertical>/<slug>.yaml"
  const match = filePath.match(
    /\/content\/([a-z]{2}-[a-z]{2})\/(quiz|blog)\/(cc|loans|insurance|education)\/([^/]+)\.ya?ml$/i,
  );
  if (!match) {
    throw new Error(
      `Cannot parse content path "${filePath}". Expected ".../content/{locale}/{section}/{vertical}/{slug}.yaml".`,
    );
  }
  return {
    locale: match[1].toLowerCase(),
    vertical: match[3] as Vertical,
    slug: match[4],
  };
}

export function quizMeta(entry: CollectionEntry<'quiz'>): ParsedId {
  return parseFilePath(entry.filePath);
}

export function postMeta(entry: CollectionEntry<'post'>): ParsedId {
  return parseFilePath(entry.filePath);
}

export async function allQuizzes() {
  return getCollection('quiz');
}

export async function allPosts() {
  return getCollection('post');
}

export async function quizzesByLocale(locale: string) {
  const all = await allQuizzes();
  return all.filter((e) => quizMeta(e).locale === locale);
}

export async function postsByLocale(locale: string) {
  const all = await allPosts();
  return all.filter((e) => postMeta(e).locale === locale);
}

export async function postsByLocaleAndVertical(locale: string, vertical: Vertical) {
  const all = await postsByLocale(locale);
  return all.filter((e) => postMeta(e).vertical === vertical);
}

export async function findQuiz(locale: string, vertical: Vertical, slug: string) {
  const all = await allQuizzes();
  return all.find((e) => {
    const meta = quizMeta(e);
    return meta.locale === locale && meta.vertical === vertical && meta.slug === slug;
  });
}

export async function findPost(locale: string, vertical: Vertical, slug: string) {
  const all = await allPosts();
  return all.find((e) => {
    const meta = postMeta(e);
    return meta.locale === locale && meta.vertical === vertical && meta.slug === slug;
  });
}

// Related posts by shared vertical, most-recent first, excluding the current
// post. Imported posts ship empty `relatedSlugs`, so vertical adjacency is the
// available signal until `tags` lands (Phase C).
export async function relatedByVertical(
  locale: string,
  vertical: Vertical,
  excludeSlug: string,
  limit = 4,
) {
  const inVertical = await postsByLocaleAndVertical(locale, vertical);
  return inVertical
    .filter((e) => postMeta(e).slug !== excludeSlug)
    .sort((a, b) => b.data.publishedAt.getTime() - a.data.publishedAt.getTime())
    .slice(0, limit);
}
