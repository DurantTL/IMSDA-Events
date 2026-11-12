import type { Metadata } from "next";
import Script from "next/script";
import { getRequestNonce } from "@/modules/security/request-nonce";

/** Embed pages run inside other sites' frames: no saved-app manifest or web-app tags (#1713). */
export const metadata: Metadata = { manifest: null, appleWebApp: null };

export default async function EmbedLayout({ children }: { children: React.ReactNode }) {
  const nonce = await getRequestNonce();
  return (
    <>
      <div className="imsda-embed-layout" data-imsda-embed-root>
        {children}
      </div>
      <Script src="/embed/embed.js" nonce={nonce} strategy="afterInteractive" />
    </>
  );
}
