import { describe, expect, it } from 'vitest';
import { buildMenuTree, parseMenuLocations, dropMenuItemsByObjectId } from './wp-menu';

const WP = 'https://limitemais.com';

describe('buildMenuTree', () => {
  const raw = [
    { id: 1, title: { rendered: 'Cart&#227;o de Cr&#233;dito' }, url: 'https://limitemais.com/cartao-de-credito/', menu_order: 2, menu_item_parent: 0 },
    { id: 2, title: { rendered: 'Empr&#233;stimo' }, url: 'https://limitemais.com/emprestimo/', menu_order: 1, menu_item_parent: 0 },
    { id: 3, title: { rendered: 'Pessoal' }, url: 'https://limitemais.com/emprestimo/pessoal/', menu_order: 1, menu_item_parent: 2 },
    { id: 4, title: { rendered: 'Externo' }, url: 'https://example.com/x', menu_order: 3, menu_item_parent: 0 },
  ];

  it('orders top-level items by menu_order', () => {
    const tree = buildMenuTree(raw, { wpBaseUrl: WP });
    expect(tree.map((i) => i.label)).toEqual(['Empréstimo', 'Cartão de Crédito', 'Externo']);
  });

  it('relativizes WP-origin urls but keeps external ones', () => {
    const tree = buildMenuTree(raw, { wpBaseUrl: WP });
    expect(tree[0].url).toBe('/emprestimo/');
    expect(tree.find((i) => i.label === 'Externo')!.url).toBe('https://example.com/x');
  });

  it('nests children under their parent', () => {
    const tree = buildMenuTree(raw, { wpBaseUrl: WP });
    const emprestimo = tree.find((i) => i.label === 'Empréstimo')!;
    expect(emprestimo.children.map((c) => c.label)).toEqual(['Pessoal']);
  });

  it('decodes entities and trims trailing separators', () => {
    const tree = buildMenuTree([{ id: 9, title: { rendered: 'Termos de Uso -&nbsp;' }, url: 'https://limitemais.com/termos/', menu_order: 0 }], { wpBaseUrl: WP });
    expect(tree[0].label).toBe('Termos de Uso');
  });

  it('returns [] for non-array input', () => {
    expect(buildMenuTree(null)).toEqual([]);
    expect(buildMenuTree({ code: 'rest_forbidden' })).toEqual([]);
  });

  it('carries object_id as objectId (0 for custom links)', () => {
    const tree = buildMenuTree([
      { id: 1, title: { rendered: 'Blog' }, url: 'https://limitemais.com/blog/', menu_order: 1, object_id: 1288 },
      { id: 2, title: { rendered: 'Externo' }, url: 'https://example.com/x', menu_order: 2 },
    ], { wpBaseUrl: WP });
    expect(tree.find((i) => i.label === 'Blog')!.objectId).toBe(1288);
    expect(tree.find((i) => i.label === 'Externo')!.objectId).toBe(0);
  });
});

describe('dropMenuItemsByObjectId', () => {
  const tree = buildMenuTree([
    { id: 1, title: { rendered: 'Cartão' }, url: 'https://limitemais.com/cartao/', menu_order: 1, object_id: 5 },
    { id: 2, title: { rendered: 'Blog' }, url: 'https://limitemais.com/blog/', menu_order: 2, object_id: 1288 },
    { id: 3, title: { rendered: 'Filho Blog' }, url: 'https://limitemais.com/blog/', menu_order: 1, object_id: 1288, menu_item_parent: 1 },
  ], { wpBaseUrl: WP });

  it('drops items pointing at the id, at any depth', () => {
    const out = dropMenuItemsByObjectId(tree, 1288);
    expect(out.map((i) => i.label)).toEqual(['Cartão']);
    expect(out[0].children).toEqual([]); // nested Blog child removed
  });

  it('is a no-op for id 0', () => {
    expect(dropMenuItemsByObjectId(tree, 0)).toBe(tree);
  });
});

describe('parseMenuLocations', () => {
  it('maps location slug → menu id', () => {
    const out = parseMenuLocations({ primary: { name: 'Primary', menu: 12 }, footer: { name: 'Footer', menu: 34 }, empty: { menu: 0 } });
    expect(out).toEqual({ primary: 12, footer: 34 });
  });
  it('returns {} for non-object input', () => {
    expect(parseMenuLocations(null)).toEqual({});
  });
});
