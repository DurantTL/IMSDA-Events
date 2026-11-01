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
 * new name is absent, so nobody is signed out by the deploy, and it is expired
 * whenever the session is set again and by `proxy.ts` on every page request.
 * Remove the legacy handling (`legacyName`, the proxy step) after that release.
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

export function createSessionCookie(legacyName: string, migrationMaxAgeSeconds: number) {
  const hostName = `__Host-${legacyName}`;
  return {
    /** The plain name: the only name outside production, the fallback read name inside it. */
    legacyName,
    hostName,
    /** Used by the proxy when it copies a legacy cookie to the new name. */
    migrationMaxAgeSeconds,
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

/** 8 hours: the staff session lifetime (`SESSION_LIFETIME_SECONDS`). */
export const staffSessionCookie = createSessionCookie("imsda_session", 8 * 60 * 60);
/** 14 days: the attendee session lifetime (`ATTENDEE_SESSION_LIFETIME_SECONDS`). */
export const attendeeSessionCookie = createSessionCookie("imsda_attendee_session", 14 * 24 * 60 * 60);
