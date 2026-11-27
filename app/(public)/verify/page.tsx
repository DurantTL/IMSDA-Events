import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BrandLink } from "@/components/brand-link";
import { CertificateCheckForm } from "@/components/certificate-check-form";
import { CERTIFICATE_NOT_FOUND_MESSAGE, normalizeCertificateCode } from "@/modules/club-certificates/domain";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Check a certificate",
  description: "Check the verification number printed on an IMAdventist club certificate.",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * The public page to check a certificate by its number (#2052). No sign-in. A number in the query goes to its own result
 * page; one that is not 8 valid characters shows the same "couldn't find it" as an unknown number.
 */
export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ code?: string | string[] }> }) {
  const raw = (await searchParams).code;
  const entered = typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : undefined;
  if (entered !== undefined && entered.trim() !== "") {
    const code = normalizeCertificateCode(entered);
    if (code) redirect(`/verify/${code}`);
  }
  return (
    <main className="auth-page">
      <section className="auth-card">
        <BrandLink className="auth-brand" wordmark />
        <div className="auth-heading">
          <p className="eyebrow">Certificate check</p>
          <h1>Check a certificate</h1>
          <p>Type the verification number printed on the certificate, or scan its QR code.</p>
        </div>
        {entered !== undefined && entered.trim() !== "" && <p className="inline-notice" role="alert">{CERTIFICATE_NOT_FOUND_MESSAGE}</p>}
        <CertificateCheckForm />
      </section>
    </main>
  );
}
