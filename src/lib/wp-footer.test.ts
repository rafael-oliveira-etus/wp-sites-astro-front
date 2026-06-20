import { describe, expect, it } from 'vitest';
import { normalizeFooterWidgets } from './wp-footer';

describe('normalizeFooterWidgets', () => {
  const raw = [
    { sidebar: 'left-footer-widget', rendered: '<p>Logo desk</p>' },
    { sidebar: 'left-footer-widget', rendered: '<p>tagline</p>' },
    { sidebar: 'left-footer-widget-mob', rendered: '<p>Logo mob</p>' },
    { sidebar: 'subfooter-left-widget', rendered: '<p>Address</p>' },
    { sidebar: 'disclaimer', rendered: '<p>Legal</p>' },
    { sidebar: 'wp_inactive_widgets', rendered: '<p>ignored</p>' },
  ];

  it('groups + concatenates rendered HTML per footer area', () => {
    const w = normalizeFooterWidgets(raw);
    expect(w.leftDesktop).toBe('<p>Logo desk</p><p>tagline</p>');
    expect(w.leftMobile).toBe('<p>Logo mob</p>');
    expect(w.subfooterLeft).toBe('<p>Address</p>');
    expect(w.disclaimer).toBe('<p>Legal</p>');
  });

  it('returns empty strings for absent areas (no fallback)', () => {
    const w = normalizeFooterWidgets([]);
    expect(w.leftDesktop).toBe('');
    expect(w.disclaimer).toBe('');
  });
});
