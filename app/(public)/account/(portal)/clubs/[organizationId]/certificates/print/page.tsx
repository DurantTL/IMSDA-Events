import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { clubAccessClosed } from "@/components/club-access-closed";
import { ExactValue } from "@/components/exact-value";
import { PrintReportButton } from "@/components/print-report-button";
import styles from "@/components/club-certificates.module.css";
import { BRAND_SYMBOL_PATH } from "@/lib/brand";
import { formatPersonName } from "@/lib/person-name";
import { formatCertificateCode, formatCompletionDate } from "@/modules/club-certificates/domain";
import { certificateQr, certificateVerifyHost, certificateVerifyUrl } from "@/modules/club-certificates/qr";
import { loadCertificateSheets } from "@/modules/club-certificates/repository";
import { actorAttribution, getRosterAccessStateForPage } from "@/modules/club-rosters/access";

export const metadata: Metadata = { title: "Print certificates" };
export const dynamic = "force-dynamic";

/** The small check corner of a certificate (#2052): a QR code to the public check page, the number, and where to check it by hand. */
function VerifyCorner({ code, host }: { code: string; host: string }) {
  const qr = certificateQr(certificateVerifyUrl(code));
  return (
    <div className={styles.verify}>
      <svg aria-label="QR code that opens the page to check this certificate" className={styles.verifyQr} role="img" shapeRendering="crispEdges" viewBox={`-2 -2 ${qr.size + 4} ${qr.size + 4}`}>
        <path d={qr.path} fill="currentColor" />
      </svg>
      <span className={styles.verifyText}>
        <span>{"Verification number "}<ExactValue>{formatCertificateCode(code)}</ExactValue></span>
        <span>{"Check it at "}<ExactValue>{`${host}/verify`}</ExactValue></span>
      </span>
    </div>
  );
}

/**
 * One landscape certificate per printed page (#1696), for the `items` in the query. The server keeps only items that are
 * current completions of people on this club's active roster; anything else is dropped. A certificate holds a name, what
 * was completed, the date and the club, and nothing else from the roster; printing records it with a verification number
 * (a reprint keeps its number) and a QR code to the public check page. Same gate as the certificates page.
 */
export default async function ClubCertificatePrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ items?: string | string[] }>;
}) {
  const [{ organizationId }, { items }] = await Promise.all([params, searchParams]);
  const access = await getRosterAccessStateForPage(organizationId);
  if (access.state !== "OPEN") return clubAccessClosed(access);
  const result = await loadCertificateSheets(organizationId, access.capabilities, items, actorAttribution(access.actor));
  if (!result) notFound();
  const host = certificateVerifyHost();
  return (
    <>
      <div className={styles.printTools}>
        <BackLink href={`/account/clubs/${organizationId}/certificates`}>Back to certificates</BackLink>
        {result.sheets.length > 0 && <PrintReportButton label="Print" primary />}
      </div>
      {result.sheets.length === 0
        ? <p className="inline-notice">Nothing to print. Go back and pick the completions to print.</p>
        : (
          <>
            <p className={`${styles.meta} ${styles.printTools}`}>{`${result.sheets.length} ${result.sheets.length === 1 ? "certificate" : "certificates"}, one per page. In the print window, choose Save as PDF to keep a file.`}</p>
            <div className={styles.sheets}>
              {result.sheets.map((sheet) => (
                <section aria-label={`Certificate for ${formatPersonName(sheet)}: ${sheet.title}`} className={styles.certificate} key={sheet.key}>
                  <Image alt="" aria-hidden="true" className={styles.symbol} height={72} src={BRAND_SYMBOL_PATH} width={72} />
                  <h2 className={styles.heading}>Certificate of completion</h2>
                  <p className={styles.lead}>This certifies that</p>
                  <p className={styles.name}>{formatPersonName(sheet)}</p>
                  <p className={styles.lead}>has completed</p>
                  <p className={styles.what}>{sheet.title}</p>
                  <p className={styles.when}>{formatCompletionDate(sheet.completedOn)}</p>
                  <p className={styles.club}>{result.clubName}</p>
                  <div className={styles.signatures}>
                    <span className={styles.signature}>Director</span>
                    <span className={styles.signature}>Date</span>
                  </div>
                  <VerifyCorner code={sheet.code} host={host} />
                </section>
              ))}
            </div>
          </>
        )}
    </>
  );
}
