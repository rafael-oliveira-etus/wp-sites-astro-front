import { type Tenant, type Vertical } from './schemas';

export interface ResolvedAuthor {
  id: string;
  name: string;
  title?: string;
  bio?: string;
  avatar?: string;
  url?: string;
  sameAs: string[];
}

export function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

// The reviewer credited on a post (E-E-A-T): the named expert assigned to the
// post's vertical (tenant.authorByVertical → tenant.authors), else a per-post
// author override, else the tenant editorial identity.
export function resolveAuthor(
  tenant: Tenant,
  vertical: Vertical,
  postAuthor?: { name: string; bio?: string; url?: string },
): ResolvedAuthor {
  const id = tenant.authorByVertical?.[vertical];
  if (id) {
    const a = tenant.authors?.[id];
    if (a) return { id, name: a.name, title: a.title || undefined, bio: a.bio || undefined, avatar: a.avatar, url: a.url, sameAs: a.sameAs || [] };
  }
  if (postAuthor?.name) return { id: slugifyName(postAuthor.name), name: postAuthor.name, bio: postAuthor.bio || undefined, url: postAuthor.url, sameAs: [] };
  const e = tenant.editorial;
  return { id: 'editorial', name: e?.name || 'Editorial', bio: e?.bio || undefined, url: e?.url, sameAs: [] };
}

export function authorById(tenant: Tenant, id: string): ResolvedAuthor | null {
  const a = tenant.authors?.[id];
  if (!a) return null;
  return { id, name: a.name, title: a.title || undefined, bio: a.bio || undefined, avatar: a.avatar, url: a.url, sameAs: a.sameAs || [] };
}

// Verticals an author is the assigned reviewer for (drives their /author page).
export function verticalsForAuthor(tenant: Tenant, id: string): Vertical[] {
  return Object.entries(tenant.authorByVertical || {})
    .filter(([, aid]) => aid === id)
    .map(([v]) => v as Vertical);
}
