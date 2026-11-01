// The site's Content-Security-Policy, built per request by `proxy.ts` (#1401).
// It lives here, not in `next.config.ts`, because `script-src` carries a
// per-request nonce and a response must never get two policies.

export const DEFAULT_EMBED_ALLOWED_ORIGINS = "'self' https://imsda.org https://*.imsda.org";

const squareWebOrigins = [
  "https://web.squarecdn.com",
  "https://sandbox.web.squarecdn.com",
].join(" ");
const squarePciOrigins = [
  "https://pci-connect.squareup.com",
  "https://pci-connect.squareupsandbox.com",
].join(" ");
const squareTelemetryOrigin = "https://o160250.ingest.sentry.io";
const squareFontOrigins = [
  "https://square-fonts-production-f.squarecdn.com",
  "https://d1g145x70srn7h.cloudfront.net",
].join(" ");

// OpenStreetMap's tile server, for the public club map (#437) and the
// church-location pin picker (#480) only.
export const mapTileOrigin = "https://tile.openstreetmap.org";

// The only origins a public event page's video or map block may frame (#816).
// Keep in step with `embedFrameOrigins` in modules/events/content-embeds.ts;
// tests/event-page-embed-csp.test.ts fails when the two drift apart.
const embedFrameOrigins = [
  "https://www.youtube-nocookie.com",
  "https://player.vimeo.com",
  "https://www.google.com",
].join(" ");

// Extra origins a later issue may need on every page, such as Cloudflare
// Turnstile (#1399). Add the origin to the list for the directive it needs;
// every page then gets it. `'strict-dynamic'` ignores host sources in
// browsers that support it, so a script host listed here is only a fallback.
const extraScriptOrigins: string[] = [];
const extraFrameOrigins: string[] = [];

export type ContentSecurityPolicyInput = {
  pathname: string;
  nonce: string;
  isDevelopment: boolean;
  /** `frame-ancestors` sources for `/embed/*`; the env value or the default. */
  embedAllowedOrigins?: string;
};

type PathPolicy = {
  frameAncestors: string;
  imageOrigins: string[];
  frameOrigins: string[];
};

function pathPolicy(pathname: string, embedAllowedOrigins: string): PathPolicy {
  const policy: PathPolicy = { frameAncestors: "'none'", imageOrigins: [], frameOrigins: [] };

  if (pathname === "/embed" || pathname.startsWith("/embed/")) {
    policy.frameAncestors = embedAllowedOrigins;
  } else if (/^\/clubs\/?$/.test(pathname) || /^\/admin\/organizations\/[^/]+\/location\/?$/.test(pathname)) {
    policy.imageOrigins.push(mapTileOrigin);
  } else if (/^\/events\/[^/]+\/?$/.test(pathname)) {
    // Exactly the public event page: registration subpaths stay locked.
    policy.frameOrigins.push(embedFrameOrigins);
  }

  return policy;
}

/** A fresh, unguessable, base64 nonce for one request. */
export function generateNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function buildContentSecurityPolicy({
  pathname,
  nonce,
  isDevelopment,
  embedAllowedOrigins: embedAllowedOriginsInput,
}: ContentSecurityPolicyInput) {
  // An empty or blank value (Compose passes `${EMBED_ALLOWED_ORIGINS:-}`) means the default.
  const embedAllowedOrigins = embedAllowedOriginsInput?.trim() || DEFAULT_EMBED_ALLOWED_ORIGINS;
  const path = pathPolicy(pathname, embedAllowedOrigins);
  const scriptSources = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    // Fallback for browsers without 'strict-dynamic'; ignored where it works.
    squareWebOrigins,
    ...extraScriptOrigins,
    ...(isDevelopment ? ["'unsafe-eval'"] : []),
  ];
  const frameSources = ["'self'", squareWebOrigins, ...extraFrameOrigins, ...path.frameOrigins];
  const imageSources = ["'self'", "blob:", "data:", ...path.imageOrigins];

  return [
    "default-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    `style-src 'self' 'unsafe-inline' ${squareWebOrigins}`,
    `img-src ${imageSources.join(" ")}`,
    `font-src 'self' data: ${squareFontOrigins}`,
    `connect-src 'self' ${squareWebOrigins} ${squarePciOrigins} ${squareTelemetryOrigin}`,
    `frame-src ${frameSources.join(" ")}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${path.frameAncestors}`,
  ].join("; ");
}
