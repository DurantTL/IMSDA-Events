import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { REQUEST_TARGET_HEADER } from "@/modules/access/login-routing";
import { wantsRequestTarget } from "@/modules/access/request-target";
import { attendeeSessionCookie, staffSessionCookie } from "@/modules/security/session-cookies";
import {
  buildContentSecurityPolicy,
  DEFAULT_EMBED_ALLOWED_ORIGINS,
  generateNonce,
} from "@/modules/security/content-security-policy";

/**
 * Sends the page's Content-Security-Policy with a fresh per-request nonce
 * (#1401). The policy goes on the *request* too, so Next.js reads the nonce
 * from it and applies it to its own scripts, and as `x-nonce` for the few
 * script tags we render ourselves (see `getRequestNonce`). It also records
 * the requested path and query on staff and account requests only, so server
 * components can send a signed-out visitor to `/login?next=...` (#108); a
 * client-supplied value is overwritten, and the reader validates it with
 * `safeReturnTo` anyway. No redirects and no rewrites. Every other header
 * still comes from `next.config.ts`.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const nonce = generateNonce();
  const policy = buildContentSecurityPolicy({
    pathname,
    nonce,
    isDevelopment: process.env.NODE_ENV === "development",
    embedAllowedOrigins: process.env.EMBED_ALLOWED_ORIGINS?.trim() || DEFAULT_EMBED_ALLOWED_ORIGINS,
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);
  if (wantsRequestTarget(pathname)) {
    requestHeaders.set(REQUEST_TARGET_HEADER, `${pathname}${search}`);
  } else {
    requestHeaders.delete(REQUEST_TARGET_HEADER);
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  migrateLegacySessionCookies(request, response);
  return response;
}

/**
 * One release of `__Host-` migration (#1402). In production a browser that
 * still holds a plain-named session cookie gets the same token under the
 * `__Host-` name, and the plain one is expired. Server components cannot set
 * cookies, so this is where it happens, on any page request. The token is
 * copied as is (the database holds the real expiry); the cookie lifetime is
 * the session's full lifetime. The readers already fall back to the plain
 * name, so the request in flight and any request this never reaches stay
 * signed in. Remove with the fallback after that release.
 */
function migrateLegacySessionCookies(request: NextRequest, response: NextResponse) {
  if (process.env.NODE_ENV !== "production") return;
  for (const cookie of [staffSessionCookie, attendeeSessionCookie]) {
    const legacy = request.cookies.get(cookie.legacyName)?.value;
    if (legacy === undefined) continue;
    if (legacy && !request.cookies.get(cookie.hostName)?.value) {
      cookie.set(response.cookies, legacy, { maxAge: cookie.migrationMaxAgeSeconds });
    } else {
      cookie.clearLegacy(response.cookies);
    }
  }
}

export const config = {
  matcher: [
    // Every page, except API routes, Next's static files, the two embed
    // scripts (JavaScript, not documents), common `public/` file types, and
    // prefetches (the guide's pattern). A `public/` file under a staff prefix
    // (such as /help/*.webp) still matches the entries below; that is harmless.
    {
      source:
        "/((?!api(?:/|$)|_next/static|_next/image|favicon\\.ico|embed/embed(?:-host)?\\.js$|\\.well-known/|fixtures/|.*\\.(?:png|webp|jpe?g|svg|csv|txt)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
    // Staff and account pages also need the request target on prefetches, as
    // before (#568), so they match without the prefetch exclusion. Next.js
    // reads this config statically: keep it literal, in step with
    // `requestTargetPrefixes` above (tests/content-security-proxy.test.ts).
    "/account/:path*",
    "/admin/:path*",
    "/check-in/:path*",
    "/communications/:path*",
    "/community/:path*",
    "/finance/:path*",
    "/help/:path*",
    "/imports/:path*",
    "/information-forms/:path*",
    "/more/:path*",
    "/overview/:path*",
    "/profile/:path*",
    "/people/:path*",
    "/registration-builder/:path*",
    "/staff/:path*",
    "/event-setup/:path*",
    "/events-admin/:path*",
    "/no-access",
    "/select-event",
    "/archived-events",
  ],
};
