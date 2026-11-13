/**
 * Kept free of imports: the instrumentation hook reads it through `lib/token-path.ts`.
 */

/**
 * Routes whose last path segment is a secret token (a `[token]` folder under `app/`), as the segments before the
 * token. A link on the app's own origin, or a relative one, that has a segment after one of these is private.
 * `tests/private-link-token-routes.test.ts` fails when a new `[token]` route exists that this list does not cover, and
 * `tests/token-path-redaction-guard.test.ts` fails when log redaction misses one. Private links in copied event text
 * (`modules/event-clones/private-links.ts`) and log redaction (`lib/token-path.ts`) both read it.
 */
export const tokenRoutePrefixes: readonly (readonly string[])[] = [
  ["manage"],
  ["club-forms"],
  ["health-records"],
  ["staff-invite"],
  ["unsubscribe"],
  ["clubs", "register"],
  ["account", "visiting-club"],
  ["api", "public", "manage"],
  ["api", "public", "club-forms"],
  ["api", "public", "health-records"],
  ["api", "public", "staff-invitations"],
  ["api", "public", "unsubscribe"],
  // The Pay on Square return id is an opaque bearer id for a status view (`/pay/square/return/<returnId>`).
  ["pay", "square", "return"],
  ["api", "public", "square-return"],
  // A private preview of an event page's unpublished changes (#1514).
  ["event-preview"],
  ["api", "public", "event-preview"],
];
