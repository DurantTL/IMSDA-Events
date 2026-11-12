import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { clubAccessClosed } from "@/components/club-access-closed";
import { PrintReportButton } from "@/components/print-report-button";
import styles from "@/components/club-letters.module.css";
import { loadClubLetterSheets } from "@/modules/club-letters/repository";
import { getRosterAccessStateForPage } from "@/modules/club-rosters/access";

export const metadata: Metadata = { title: "Print letters" };
export const dynamic = "force-dynamic";

/**
 * One filled-in letter or certificate per printed page (#1708), for the people in the `people` query (their roster
 * person ids). The server keeps only people on this club's active roster this club year; anyone else is dropped. The text
 * is plain and shown with React's escaping. Same gate as the letters page; a template of another club is "not found".
 */
export default async function ClubLetterPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string; templateId: string }>;
  searchParams: Promise<{ people?: string | string[] }>;
}) {
  const [{ organizationId, templateId }, { people }] = await Promise.all([params, searchParams]);
  const access = await getRosterAccessStateForPage(organizationId);
  if (access.state !== "OPEN") return clubAccessClosed(access);
  const result = await loadClubLetterSheets(organizationId, access.capabilities, templateId, people);
  if (!result) notFound();
  const certificate = result.kind === "CERTIFICATE";
  return (
    <>
      <div className={styles.printTools}>
        <BackLink href={`/account/clubs/${organizationId}/letters`}>Back to letters</BackLink>
        {result.sheets.length > 0 && <PrintReportButton label="Print" primary />}
      </div>
      {result.sheets.length === 0
        ? <p className="inline-notice">{"Nobody on this year's roster was chosen. Go back and pick the people to print for."}</p>
        : (
          <>
            <p className={`${styles.meta} ${styles.printTools}`}>{`${result.title}: ${result.sheets.length} ${result.sheets.length === 1 ? "page" : "pages"}. In the print window, choose Save as PDF to keep a file.`}</p>
            <div className={styles.sheets}>
              {result.sheets.map((sheet) => (
                <section aria-label={`${result.title}`} className={`${styles.sheet} ${certificate ? styles.certificate : ""}`} key={sheet.personId}>
                  <p className={styles.sheetBody}>{sheet.text}</p>
                </section>
              ))}
            </div>
          </>
        )}
    </>
  );
}
