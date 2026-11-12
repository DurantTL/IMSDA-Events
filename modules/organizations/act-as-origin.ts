/**
 * Where "Stop acting" returns to (N3, 2026-11-06). The page that started an Area Coordinator act-as sends a short key,
 * never a path; the start route keeps the key in a cookie and the stop route turns it back into a path from this fixed
 * list. Anything not on the list is ignored, so no address from the request can become a redirect.
 */
// The cookie is scoped to the browser, not the staff session; that is harmless because it only ever maps to the allowlist below.
export const ACT_AS_ORIGIN_COOKIE = "imsda_act_as_origin";

const originPaths = {
  clubs: "/admin/clubs",
  people: "/admin/people",
  youth: "/admin/youth",
} as const;

export type ActAsOrigin = keyof typeof originPaths;

export function parseActAsOrigin(value: unknown): ActAsOrigin | null {
  return typeof value === "string" && Object.hasOwn(originPaths, value) ? (value as ActAsOrigin) : null;
}

export function actAsOriginPath(value: unknown): string | null {
  const origin = parseActAsOrigin(value);
  return origin ? originPaths[origin] : null;
}

/** The same attributes whenever the cookie is set or cleared, so a clear always matches what was set. */
export function actAsOriginCookieOptions(maxAge: number) {
  return { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge };
}
