import { wpOriginVariants } from './wp-html';

export interface WpMenuItem {
  id: number;
  label: string;
  url: string;
  order: number;
  /** The WP object this item points at (0 for custom links). Used to drop the
   *  posts-page ("Blog") link, which is `page_for_posts` — see dropMenuItemsByObjectId. */
  objectId: number;
  children: WpMenuItem[];
}

/** Recursively drop menu items pointing at a given WP object id (e.g. the
 *  posts-page link, since the front renders the feed at `/`). id 0 → no-op. */
export function dropMenuItemsByObjectId(items: WpMenuItem[], objectId: number): WpMenuItem[] {
  if (!objectId) return items;
  return items
    .filter((i) => i.objectId !== objectId)
    .map((i) => ({ ...i, children: dropMenuItemsByObjectId(i.children, objectId) }));
}

function decode(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/<[^>]*>/g, '')
    .replace(/[\s\-–—|·]+$/u, '') // trailing separators WP themes append (e.g. "Termos -")
    .trim();
}

/** Relativize a WP-origin URL so menu links stay in-app; keep external/CDN as-is. */
function relativize(url: string, wpBaseUrl?: string): string {
  if (!wpBaseUrl) return url;
  for (const o of wpOriginVariants(wpBaseUrl)) {
    if (url === o || url === `${o}/`) return '/';
    if (url.startsWith(`${o}/`)) return url.slice(o.length);
  }
  return url;
}

/**
 * Normalize raw `wp/v2/menu-items` objects into an ordered nested tree.
 * Pure: takes the raw array, returns top-level items with `children`.
 */
export function buildMenuTree(rawItems: unknown, opts: { wpBaseUrl?: string } = {}): WpMenuItem[] {
  const arr = Array.isArray(rawItems) ? rawItems : [];
  const byId = new Map<number, WpMenuItem & { parent: number }>();
  for (const raw of arr) {
    const i = (raw ?? {}) as Record<string, any>;
    const id = Number(i.id ?? 0);
    if (!id) continue;
    byId.set(id, {
      id,
      label: decode(String(i.title?.rendered ?? i.title ?? '')),
      url: relativize(String(i.url ?? '#'), opts.wpBaseUrl),
      order: Number(i.menu_order ?? 0),
      objectId: Number(i.object_id ?? 0),
      parent: Number(i.menu_item_parent ?? i.parent ?? 0),
      children: [],
    });
  }
  const roots: WpMenuItem[] = [];
  for (const item of byId.values()) {
    const parent = item.parent ? byId.get(item.parent) : undefined;
    if (parent) parent.children.push(item);
    else roots.push(item);
  }
  const sort = (items: WpMenuItem[]) => {
    items.sort((a, b) => a.order - b.order);
    items.forEach((c) => sort(c.children));
  };
  sort(roots);
  return roots;
}

/** location → menu id, from a `wp/v2/menu-locations` response object. */
export function parseMenuLocations(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  const obj = (raw ?? {}) as Record<string, any>;
  for (const [loc, val] of Object.entries(obj)) {
    const menuId = Number((val as Record<string, any>)?.menu ?? 0);
    if (menuId) out[loc] = menuId;
  }
  return out;
}
