import type { Metadata } from "next";
import Link from "next/link";
import { BrandLink } from "@/components/brand-link";
import { CertificateCheckForm } from "@/components/certificate-check-form";
import { ExactValue } from "@/components/exact-value";
import { CERTIFICATE_NOT_FOUND_MESSAGE, CERTIFICATE_VOIDED_MESSAGE, certificateCheckView } from "@/modules/club-certificates/domain";
import { findCertificateForCheck } from "@/modules/club-certificates/repository";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Check a certificate",
  description: "Check the verification number printed on an IMAdventist club certificate.",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * The result of a certificate check (#2052), no sign-in. It says only whether the certificate is genuine and, if so, the
 * honor or class, the kind, the completion date and the club. Never the person's name or any roster field. A withdrawn
 * certificate shows no details. A number that is unknown or not well formed gets one and the same answer, so nothing
 * hints at which numbers exist. The number is printed on paper, so it is in the address and is not a secret.
 */
export default async function VerifyResultPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const view = certificateCheckView(await findCertificateForCheck(code));
  return (
    <main className="auth-page">
      <section className="auth-card">
        <BrandLink className="auth-brand" wordmark />
        <div className="auth-heading">
          <p className="eyebrow">Certificate check</p>
          {view.status === "GENUINE" && (
            <>
              <h1>This certificate is genuine</h1>
              <p>It was issued by the club named below.</p>
            </>
          )}
          {view.status === "WITHDRAWN" && <h1>This certificate is no longer valid</h1>}
          {view.status === "NOT_FOUND" && <h1>Certificate not found</h1>}
        </div>
        {view.status === "GENUINE" && (
          <div role="status">
            <p><strong>{view.kindLabel}:</strong> <ExactValue>{view.title}</ExactValue></p>
            <p><strong>Completed:</strong> {view.completedOn}</p>
            <p><strong>Club:</strong> <ExactValue>{view.clubName}</ExactValue></p>
          </div>
        )}
        {view.status === "WITHDRAWN" && <p className="inline-notice" role="status">{CERTIFICATE_VOIDED_MESSAGE}</p>}
        {view.status === "NOT_FOUND" && (
          <>
            <p className="inline-notice" role="status">{CERTIFICATE_NOT_FOUND_MESSAGE}</p>
            <CertificateCheckForm />
          </>
        )}
        {view.status !== "NOT_FOUND" && <p className="quiet-copy"><Link href="/verify">Check another certificate</Link></p>}
      </section>
    </main>
  );
}
