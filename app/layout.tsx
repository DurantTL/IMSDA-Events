import type { Metadata } from "next";
import "@fontsource/noto-sans/400.css";
import "@fontsource/noto-sans/500.css";
import "@fontsource/noto-sans/600.css";
import "@fontsource/noto-sans/700.css";
import "./globals.css";
import { PublicWebVitals } from "@/components/public-metrics-beacon";
import { sidebarCollapseInitScript } from "@/components/sidebar-collapse";
import { UnsavedChangesDialogHost } from "@/components/unsaved-changes-dialog-host";
import { getRequestNonce } from "@/modules/security/request-nonce";
import { zodJitlessInitScript } from "@/modules/security/zod-jitless";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_BASE_URL ?? "http://localhost:3000"),
  title: {
    default: "IMSDA Events",
    template: "%s | IMSDA Events",
  },
  description:
    "Event information and registration for the Iowa-Missouri Conference.",
  applicationName: "IMSDA Events",
};

// Reading the request nonce makes every page render per request, which the
// nonce-based Content-Security-Policy from proxy.ts needs (#1401).
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = await getRequestNonce();
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: zodJitlessInitScript + sidebarCollapseInitScript }} /></head>
      <body>{children}<PublicWebVitals /><UnsavedChangesDialogHost /></body>
    </html>
  );
}
