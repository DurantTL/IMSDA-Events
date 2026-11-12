import type { Metadata, Viewport } from "next";
import "@fontsource/noto-sans/400.css";
import "@fontsource/noto-sans/500.css";
import "@fontsource/noto-sans/600.css";
import "@fontsource/noto-sans/700.css";
import "./globals.css";
import { BRAND_APPLE_TOUCH_PATH, PRODUCT_NAME } from "@/lib/brand";
import { SITE_APP_COLOR, SITE_MANIFEST_PATH } from "@/lib/site-web-app";
import { PublicWebVitals } from "@/components/public-metrics-beacon";
import { UnsavedChangesDialogHost } from "@/components/unsaved-changes-dialog-host";
import { getRequestNonce } from "@/modules/security/request-nonce";
import { zodJitlessInitScript } from "@/modules/security/zod-jitless";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_BASE_URL ?? "http://localhost:3000"),
  title: {
    default: PRODUCT_NAME,
    template: `%s | ${PRODUCT_NAME}`,
  },
  description:
    "Event information and registration for the Iowa-Missouri Conference.",
  applicationName: PRODUCT_NAME,
  icons: { icon: "/brand/favicon.ico", apple: BRAND_APPLE_TOUCH_PATH },
  // The installable web app (#1713). The staff workspace layout replaces the manifest with its own (#1567) and the embed
  // layout removes it, so each page links exactly one manifest, or none inside another site's frame.
  manifest: SITE_MANIFEST_PATH,
  appleWebApp: { capable: true, title: PRODUCT_NAME, statusBarStyle: "default" },
};

// The page runs edge to edge (viewport-fit=cover) so the safe-area insets are real: a notch, rounded corners and the home
// indicator give `env(safe-area-inset-*)` a value, and the shell's fixed bars and sheets pad by it (#1566, docs/RESPONSIVE.md).
// The keyboard keeps the browser's default (it overlays, the layout stays put); the staff phone bar steps aside while a field has focus.
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: SITE_APP_COLOR };

// Reading the request nonce makes every page render per request, which the
// nonce-based Content-Security-Policy from proxy.ts needs (#1401).
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = await getRequestNonce();
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: zodJitlessInitScript }} /></head>
      <body>{children}<PublicWebVitals /><UnsavedChangesDialogHost /></body>
    </html>
  );
}
