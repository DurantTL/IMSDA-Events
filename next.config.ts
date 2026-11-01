import type { NextConfig } from "next";

const buildTsconfigPath = process.env.NEXT_BUILD_TSCONFIG?.trim() || "tsconfig.json";
// Only the Docker image sets this, because the check needs more memory than the
// production server has. CI type-checks every commit; deploy only green ones.
const skipBuildTypecheck = process.env.NEXT_SKIP_BUILD_TYPECHECK === "1";

const sharedSecurityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Google Pay opens a wallet window. `same-origin` breaks that handoff on
  // iOS; Square documents this value for Web Payments SDK wallet support.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
];

const privateRegistrationHeaders = [
  { key: "Cache-Control", value: "private, no-store, max-age=0" },
  { key: "Pragma", value: "no-cache" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
];

const nextConfig: NextConfig = {
  // No "X-Powered-By: Next.js" (#1401).
  poweredByHeader: false,
  // The Content-Security-Policy is not set here: proxy.ts sends it per
  // request with a nonce (modules/security/content-security-policy.ts).
  // Docker's production build checks only code that can ship in the app. The
  // normal local/CI build keeps using tsconfig.json, which also covers tests,
  // import helpers, and operator scripts.
  typescript: {
    tsconfigPath: buildTsconfigPath,
    ignoreBuildErrors: skipBuildTypecheck,
  },
  async redirects() {
    return [
      // "/dashboard" is a guessed address for the staff home, which is
      // "/overview" (#567 F-27). Not permanent, so a real page could take it.
      {
        source: "/dashboard",
        destination: "/overview",
        permanent: false,
      },
      // A signed-out visitor to check-in goes to staff sign-in and comes
      // back here afterwards (#470). The staff workspace layout redirects
      // signed-out requests to a bare "/login" and, since layouts render in
      // parallel with pages, wins over the page's own redirect; this rule
      // runs before rendering. It only checks that the session cookie is
      // absent (the name matches SESSION_COOKIE_NAME, asserted in
      // tests/route-fallbacks.test.ts); the page and layout still verify
      // any session that is present. Not permanent: it depends on a cookie.
      {
        source: "/check-in",
        has: [{ type: "query", key: "event", value: "(?<event>[A-Za-z0-9_-]{1,64})" }],
        missing: [{ type: "cookie", key: "imsda_session" }],
        destination: "/login?next=/check-in%3Fevent%3D:event",
        permanent: false,
      },
      {
        source: "/check-in",
        missing: [{ type: "cookie", key: "imsda_session" }],
        destination: "/login?next=/check-in",
        permanent: false,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          ...sharedSecurityHeaders,
          ...(process.env.NODE_ENV === "production"
            ? [{
                key: "Strict-Transport-Security",
                value: "max-age=31536000; includeSubDomains",
              }]
            : []),
        ],
      },
      {
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      {
        source: "/embed/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      {
        source: "/manage/:path*",
        headers: privateRegistrationHeaders,
      },
      {
        source: "/api/public/manage/:path*",
        headers: privateRegistrationHeaders,
      },
      {
        // An announcement's unsubscribe link (#838) names one address: never cached, never indexed, no referrer.
        source: "/unsubscribe/:path*",
        headers: privateRegistrationHeaders,
      },
      {
        source: "/api/public/unsubscribe/:path*",
        headers: privateRegistrationHeaders,
      },
      {
        // A club form's single-use private link (#610): never cached, never indexed, no referrer.
        source: "/club-forms/:path*",
        headers: privateRegistrationHeaders,
      },
      {
        source: "/api/public/club-forms/:path*",
        headers: privateRegistrationHeaders,
      },
      {
        // A club form's public open application (#1229): a shared page, but its answers are private, so never cached or sent in a referrer.
        source: "/api/public/club-form-applications/:path*",
        headers: privateRegistrationHeaders,
      },
      {
        // A new club application's single-use private link (#817): never cached, never indexed, no referrer.
        source: "/clubs/register/:token",
        headers: privateRegistrationHeaders,
      },
      {
        source: "/api/public/club-applications",
        headers: privateRegistrationHeaders,
      },
      {
        // A personal staff invitation link (#804) is a credential: never cached, never indexed, no referrer.
        source: "/staff-invite/:path*",
        headers: privateRegistrationHeaders,
      },
      {
        source: "/api/public/staff-invitations/:path*",
        headers: privateRegistrationHeaders,
      },
      {
        // The staff-run check-in station (#892) shows a registration's names: never cached, never indexed, no referrer.
        source: "/check-in-station",
        headers: privateRegistrationHeaders,
      },
      {
        // Applications carry a director's contact details and a private attachment (#817).
        source: "/account/area-clubs/applications",
        headers: privateRegistrationHeaders,
      },
      {
        // Pages that open a health record (#611): never cached, never indexed, no referrer.
        source: "/account/clubs/:organizationId/roster/:memberId/health",
        headers: privateRegistrationHeaders,
      },
      {
        source: "/account/area-clubs/health/:path*",
        headers: privateRegistrationHeaders,
      },
      {
        source: "/more/health-records/:path*",
        headers: privateRegistrationHeaders,
      },
      {
        // A Health Record's single-use private link (#611): never cached, never indexed, no referrer.
        source: "/health-records/:path*",
        headers: privateRegistrationHeaders,
      },
      {
        source: "/api/public/health-records/:path*",
        headers: privateRegistrationHeaders,
      },
      {
        // Health information for club events (#658): never cached, never indexed, no referrer.
        source: "/account/area/health/:path*",
        headers: privateRegistrationHeaders,
      },
      {
        source: "/account/clubs/:organizationId/health/:path*",
        headers: privateRegistrationHeaders,
      },
      {
        source: "/more/event-health/:path*",
        headers: privateRegistrationHeaders,
      },
      {
        source: "/check-in",
        headers: [
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(), geolocation=(), browsing-topics=()",
          },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        ],
      },
    ];
  },
};

export default nextConfig;
