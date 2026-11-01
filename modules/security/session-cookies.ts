/**
 * Session cookie names and handling (#1402, Cloudflare audit finding 10).
 *
 * In production the staff and attendee session cookies are written with the
 * `__Host-` prefix, so a browser only accepts them when they are Secure, have
 * Path=/ and carry no Domain attribute. That stops a sibling subdomain from
 * planting or overwriting them. Outside production the app runs over http, where
 * a `__Host-` cookie would be refused, so the plain names stay.
 *
 * For one release the plain (legacy) name is still READ in production when the
 * new name is absent, so nobody is signed out by the deploy. It is expired
 * whenever the session is set again, and by `proxy.ts` on a page request that
 * already carries the `__Host-` cookie. It is never copied to the new name: a
 * sibling subdomain can plant a plain cookie, and promoting it would be session
 * fixation.
 *
 * Removing the fallback: delete `legacyName` handling here, the proxy step and
 * the `imsda_session` entry in the `next.config.ts` /check-in redirects. The
 * scripts that mint cookies under `legacyName` and rely on the fallback must
 * switch to the `__Host-` name or `writeName()` first:
 * scripts/verify-badge-print.ts, scripts/verify-mobile-layout.ts and
 * scripts/verify-honor-instructors-http.ts.
 *
 * This module is dependency-free on purpose: `proxy.ts` and scripts import it.
 * Every set, read and clear of a session cookie goes through it.
 */

export type CookieWriter = {
  set(name: string, value: string, options?: Record<string, unknown>): unknown;
};
export type CookieReader = {
  get(name: string): { value: string } | undefined;
};

export type SessionCookieSetOptions = {
  expires?: Date;
  maxAge?: number;
};

function isProduction() {
  return process.env.NODE_ENV === "production";
}

function baseOptions() {
  return {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax" as const,
    path: "/",
  };
}

export function createSessionCookie(legacyName: string) {
  const hostName = `__Host-${legacyName}`;
  return {
    /** The plain name: the only name outside production, the fallback read name inside it. */
    legacyName,
    hostName,
    /** The name this environment writes. */
    writeName: () => (isProduction() ? hostName : legacyName),
    /** The token from the current name, else (production only) the legacy name. */
    read(store: CookieReader): string | undefined {
      const current = store.get(isProduction() ? hostName : legacyName)?.value;
      if (current) return current;
      return isProduction() ? store.get(legacyName)?.value || undefined : undefined;
    },
    /** Writes the session cookie. In production also expires a leftover legacy cookie. */
    set(store: CookieWriter, token: string, options: SessionCookieSetOptions) {
      store.set(isProduction() ? hostName : legacyName, token, { ...baseOptions(), ...options, priority: "high" });
      if (isProduction()) store.set(legacyName, "", { ...baseOptions(), maxAge: 0 });
    },
    /** Expires only the plain name (the proxy step once the new name is already present). */
    clearLegacy(store: CookieWriter) {
      store.set(legacyName, "", { ...baseOptions(), maxAge: 0 });
    },
    /** Clears BOTH names. */
    clear(store: CookieWriter) {
      for (const name of [hostName, legacyName]) store.set(name, "", { ...baseOptions(), maxAge: 0 });
    },
  };
}

export const staffSessionCookie = createSessionCookie("imsda_session");
export const attendeeSessionCookie = createSessionCookie("imsda_attendee_session");
