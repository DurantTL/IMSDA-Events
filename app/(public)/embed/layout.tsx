import Script from "next/script";
import { getRequestNonce } from "@/modules/security/request-nonce";

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
