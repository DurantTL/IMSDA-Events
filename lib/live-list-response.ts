/**
 * Live lists (rule P2, #1445): the club roster above all, plus registrations,
 * attendee lists, orders and monthly records, always show what the server has
 * right now. Nothing caches them, not the browser, not Cloudflare, not the app.
 *
 * Three layers keep that true, and this file is the shared piece of them:
 * - every `/api/*` response gets `Cache-Control: no-store` from `next.config.ts`;
 * - every handler wrapped by `withRequestContext` gets the same header unless it
 *   set its own, so a route test sees it too;
 * - the roster and the other live-list handlers say it themselves with
 *   `liveJson`, and browser code reads lists with `cache: "no-store"`
 *   (tests/live-lists-no-store-1445.test.ts checks every component).
 */
export const LIVE_LIST_CACHE_CONTROL = "private, no-store, max-age=0";

/** Sets the no-store header unless the handler already chose its own `Cache-Control`. Never throws. */
export function withNoStore<T extends Response>(response: T): T {
  try {
    if (!response.headers.has("Cache-Control")) response.headers.set("Cache-Control", LIVE_LIST_CACHE_CONTROL);
  } catch {
    // Some responses have immutable headers; the global header in next.config.ts still applies.
  }
  return response;
}

/** `Response.json` for a live list: current data, never stored. */
export function liveJson(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", LIVE_LIST_CACHE_CONTROL);
  return Response.json(body, { ...init, headers });
}
