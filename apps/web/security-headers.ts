/**
 * Response headers for every page of the landing page and the backoffice (OWASP A05).
 * The CSP holds only the directives that cannot break a page: no framing, no plugins, no base-tag or form hijacking, and
 * scripts only from this site (neither app loads a script from another host), so injected markup cannot pull one in.
 * shortcut: script-src keeps 'unsafe-inline' and there is no style-src, because the server-rendered pages carry inline
 * scripts and styles that differ per page (no fixed hash). Move to a per-request nonce (router `ssr.nonce` plus a header
 * set per response, not this static rule) when a browser check can prove nothing breaks.
 */
export const securityHeaders = {
  'Content-Security-Policy': "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'; script-src 'self' 'unsafe-inline'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  // Only takes effect over HTTPS, so it is harmless on localhost.
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};
