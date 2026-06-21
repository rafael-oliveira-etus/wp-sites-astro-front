import { describe, it, expect } from 'vitest';
import { withPublicCache, PAGE_MAX_AGE } from './page-cache';

describe('withPublicCache', () => {
  it('sets public, max-age on the response', () => {
    const r = withPublicCache(new Response('<html></html>', { headers: { 'content-type': 'text/html' } }));
    expect(r.headers.get('cache-control')).toBe(`public, max-age=${PAGE_MAX_AGE}`);
  });

  it('preserves the body and other headers', async () => {
    const r = withPublicCache(new Response('<html>hi</html>', { headers: { 'content-type': 'text/html' } }));
    expect(r.headers.get('content-type')).toBe('text/html');
    expect(await r.text()).toBe('<html>hi</html>');
  });
});
