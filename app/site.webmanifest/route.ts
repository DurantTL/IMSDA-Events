import { buildSiteManifest } from "@/lib/site-web-app";

/**
 * The installable-app manifest for public and account pages (#1713). Linked from the root layout; the staff workspace links
 * its own (`/staff.webmanifest`) and embed pages link none. Public brand data only; it sets no cookie and reads no session.
 */
export function GET() {
  return new Response(JSON.stringify(buildSiteManifest()), {
    headers: { "content-type": "application/manifest+json; charset=utf-8" },
  });
}
