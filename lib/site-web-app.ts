import {
  BRAND_APPLE_TOUCH_PATH,
  BRAND_ICON_192_PATH,
  BRAND_ICON_512_PATH,
  BRAND_ICON_MASKABLE_512_PATH,
  PRODUCT_NAME,
} from "@/lib/brand";

/**
 * The installable web app for public and account pages (#1713). Like the staff saved app (#1567) it holds the brand name,
 * colors, icons and one fixed launch address, and nothing else: no record IDs, tokens, user data or query string.
 * It is not a service worker, offline cache or push setup: the saved app needs an internet connection.
 */
export const SITE_MANIFEST_PATH = "/site.webmanifest";
/** Where the saved app opens: a small route that sends each signed-in role to the right place (app/launch/route.ts). */
export const SITE_LAUNCH_PATH = "/launch";
/** The public page paper color (`--paper` in app/globals.css), for the status bar and splash. */
export const SITE_APP_COLOR = "#f4f7f8";

export function buildSiteManifest() {
  return {
    id: "/",
    name: PRODUCT_NAME,
    short_name: PRODUCT_NAME,
    description: "Events and club ministry for the Iowa-Missouri Conference: your registrations, clubs and event information.",
    start_url: SITE_LAUNCH_PATH,
    scope: "/",
    display: "standalone",
    orientation: "any",
    theme_color: SITE_APP_COLOR,
    background_color: SITE_APP_COLOR,
    icons: [
      { src: BRAND_ICON_192_PATH, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: BRAND_ICON_512_PATH, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: BRAND_APPLE_TOUCH_PATH, sizes: "180x180", type: "image/png", purpose: "any" },
      { src: BRAND_ICON_MASKABLE_512_PATH, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
