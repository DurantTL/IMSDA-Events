import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { REQUEST_TARGET_HEADER } from "@/modules/access/login-routing";
import { wantsRequestTarget } from "@/modules/access/request-target";
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
    embedAllowedOrigins: process.env.EMBED_ALLOWED_ORIGINS ?? DEFAULT_EMBED_ALLOWED_ORIGINS,
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
  return response;
}

export const config = {
  matcher: [
    // Every page, except API routes, Next's static files, the two embed
    // scripts (JavaScript, not documents), files served from `public/`, and
    // prefetches (the guide's pattern).
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
