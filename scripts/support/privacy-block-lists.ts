/**
 * A small, committed stand-in for what privacy browsers block (#1445): EasyList / EasyPrivacy / uBlock-style filters as
 * Brave Shields, Avast Secure Browser and ad-blocking extensions apply them. Each entry says what the filter is and which
 * part of IMSDA Events it hits, so a reader can tell why a request was refused.
 *
 * Modes:
 *  - control: nothing blocked (the journeys must work normally).
 *  - shields: the filters below ("standard" and "aggressive" Shields both block these).
 *  - strict: the filters, plus every third-party iframe except the one under test, third-party cookies stripped, and
 *    localStorage, sessionStorage and IndexedDB refusing access everywhere (blocked site data).
 *
 * The patterns are matched against the full request URL. They are deliberately broad, the way real lists are.
 */
export type BlockMode = "control" | "shields" | "strict";

export type BlockFilter = { name: string; pattern: RegExp; hits: string };

export const BLOCK_FILTERS: BlockFilter[] = [
  { name: "||squarecdn.com^", pattern: /^https?:\/\/([^/]+\.)?squarecdn\.com\//i, hits: "Square Web Payments script and fonts (card, Apple Pay, Google Pay)" },
  { name: "||squareup.com^ and ||squareupsandbox.com^", pattern: /^https?:\/\/([^/]+\.)?(squareup|squareupsandbox)\.com\//i, hits: "Square card tokenisation (pci-connect) and hosted pay links" },
  { name: "||challenges.cloudflare.com^", pattern: /^https?:\/\/challenges\.cloudflare\.com\//i, hits: "Cloudflare Turnstile Security check" },
  { name: "||accounts.google.com/gsi/", pattern: /^https?:\/\/accounts\.google\.com\/gsi\//i, hits: "Google sign-in script" },
  { name: "||apis.google.com^", pattern: /^https?:\/\/apis\.google\.com\//i, hits: "Google sign-in client library" },
  { name: "||sentry.io^", pattern: /^https?:\/\/([^/]+\.)?sentry\.io\//i, hits: "Square's own error telemetry" },
  { name: "||google-analytics.com^ / ||googletagmanager.com^ / ||doubleclick.net^", pattern: /^https?:\/\/([^/]+\.)?(google-analytics|googletagmanager|doubleclick)\.(com|net)\//i, hits: "Generic third-party trackers (none are used; proves nothing depends on them)" },
  { name: "/api/public-metrics", pattern: /\/api\/public-metrics(\?|$)/i, hits: "IMSDA Events' own first-party analytics beacon" },
  { name: "*/beacon*, */analytics*, */collect?*, */track*, */pixel*", pattern: /\/(beacon|analytics|track|pixel)([/.?_-]|$)|\/collect\?/i, hits: "Generic EasyPrivacy path rules" },
  { name: "*/metrics*", pattern: /\/metrics([/.?]|$)/i, hits: "Generic EasyPrivacy path rule" },
  { name: "*/vitals*", pattern: /\/vitals([/.?]|$)/i, hits: "Generic web-vitals reporting endpoints" },
];

/** The first filter that blocks this URL, or null. */
export function blockedBy(url: string): BlockFilter | null {
  return BLOCK_FILTERS.find((filter) => filter.pattern.test(url)) ?? null;
}

/**
 * Runs before any page script in strict mode: storage refuses access the way a browser with site data blocked does
 * (reading the property itself throws), and indexedDB.open fails.
 */
export const STRICT_STORAGE_INIT_SCRIPT = `
(() => {
  const deny = () => { throw new DOMException("The operation is insecure.", "SecurityError"); };
  for (const name of ["localStorage", "sessionStorage"]) {
    try { Object.defineProperty(window, name, { configurable: true, get: deny }); } catch (e) {}
  }
  try { Object.defineProperty(window, "indexedDB", { configurable: true, get: deny }); } catch (e) {}
})();
`;
