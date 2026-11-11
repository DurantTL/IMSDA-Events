import { buildStaffManifest } from "@/lib/staff-web-app";

/**
 * The staff saved-app manifest (#1567). Linked only from the staff workspace layout, so public pages
 * do not offer it. Public brand data only; it sets no cookie and reads no session.
 */
export function GET() {
  return new Response(JSON.stringify(buildStaffManifest()), {
    headers: { "content-type": "application/manifest+json; charset=utf-8" },
  });
}
