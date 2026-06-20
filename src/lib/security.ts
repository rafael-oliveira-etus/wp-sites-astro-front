/**
 * Content-Security-Policy for the GPT ad stack. PURE string builder (the nonce is
 * generated per-request in middleware via Web Crypto, then baked into BOTH this
 * header AND every inline <script> the page renders).
 *
 * WHY strict/nonce, not an origin allowlist: Google supports ONLY strict CSP for
 * GPT and explicitly recommends against domain allowlists ("the domains GPT uses
 * change over time"). Under `'strict-dynamic'` the browser IGNORES host lists and
 * `'unsafe-inline'`, so every inline script MUST carry the nonce; gpt.js (nonced)
 * then propagates trust to the scripts/iframes it injects. `'unsafe-eval'` is
 * required (GPT uses eval). Ad creatives render in SafeFrame iframes (frame-src).
 *
 * Shipped as Content-Security-Policy-Report-Only first (see middleware): it never
 * blocks, so we observe real ad-stack violations before flipping to enforcing.
 * Flip = swap the header name to `Content-Security-Policy` once reports are clean.
 *
 * Applies to SSR blog routes only — prerendered quiz/hub routes keep the static
 * `'unsafe-inline'` CSP from each tenant's `public/_headers` (middleware no-ops on
 * prerendered, so this header is never set there).
 */

/** The CSP directive string for a given per-request nonce. Script-focused
 *  (the GPT concern); styles/images are left to default and not constrained here. */
export function cspForNonce(nonce: string): string {
  return [
    `script-src 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval' https:`,
    `object-src 'none'`,
    `base-uri 'none'`,
  ].join('; ');
}

/** Header name. Report-Only until full-page nonce coverage is confirmed in prod,
 *  then flip to 'Content-Security-Policy'. */
export const CSP_HEADER = 'Content-Security-Policy-Report-Only';
