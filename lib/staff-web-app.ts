import {
  BRAND_APPLE_TOUCH_PATH,
  BRAND_ICON_192_PATH,
  BRAND_ICON_512_PATH,
  BRAND_ICON_MASKABLE_512_PATH,
  PRODUCT_NAME,
} from "@/lib/brand";

/**
 * The staff saved app (#1567): what "Add to Home Screen" stores about IMAdventist for staff.
 * It holds the brand name, colors, icons and one fixed launch address, and nothing else: no record
 * IDs, tokens, user data or query string. It is not a service worker, offline cache or push setup (#1713).
 */
export const STAFF_MANIFEST_PATH = "/staff.webmanifest";
export const STAFF_LAUNCH_PATH = "/home";
export const STAFF_APP_NAME = `${PRODUCT_NAME} Staff`;
/** The staff page paper color (`--paper` in app/globals.css), for the status bar and splash. */
export const STAFF_APP_COLOR = "#f4f7f8";

export function buildStaffManifest() {
  return {
    id: STAFF_LAUNCH_PATH,
    name: STAFF_APP_NAME,
    // Its own label, so someone who also saves the site app (#1713) can tell the two icons apart.
    short_name: STAFF_APP_NAME,
    description: "Staff workspace for events and club ministry.",
    start_url: STAFF_LAUNCH_PATH,
    scope: "/",
    display: "standalone",
    orientation: "any",
    theme_color: STAFF_APP_COLOR,
    background_color: STAFF_APP_COLOR,
    icons: [
      { src: BRAND_ICON_192_PATH, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: BRAND_ICON_512_PATH, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: BRAND_APPLE_TOUCH_PATH, sizes: "180x180", type: "image/png", purpose: "any" },
      { src: BRAND_ICON_MASKABLE_512_PATH, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
