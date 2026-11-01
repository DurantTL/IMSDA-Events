import Link from "next/link";
import { Printer } from "lucide-react";
import { DeleteClubFormLinkButton, RevokeClubFormLinkButton } from "@/components/club-forms-actions";
import type { PastYearGroup } from "@/modules/club-forms/past-years-domain";
import type { ClubFormLinkRow } from "@/modules/club-forms/links";
import type { ClubFormSubmissionListRow } from "@/modules/club-forms/submissions";
import styles from "./club-forms-lists.module.css";
import { formatInConferenceTime } from "@/modules/calendar/conference-format";

/** The director's Forms page tables (#1323), shared by the current lists and each past club year. */

function formatDate(value: string | null) {
  if (!value) return "";
  return formatInConferenceTime(value, { month: "short", day: "numeric", year: "numeric" });
}

const emailDeliveryLabel = {
  QUEUED: "Sending",
  SENT: "Sent",
  DELIVERED: "Delivered",
  NOT_DELIVERED: "Not delivered: link withdrawn, send a new one",
  UNKNOWN: "",
} as const;

const linkStateLabel = { OPEN: "Waiting", USED: "Submitted", REVOKED: "Withdrawn", EXPIRED: "Expired" } as const;

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export function ClubFormLinksTable({ links, organizationId, base, caption = "Private links" }: { links: ClubFormLinkRow[]; organizationId: string; base: string; caption?: string }) {
  return (
    <div className="report-table-wrap">
      <table className="report-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr><th scope="col">Form</th><th scope="col">Sent to</th><th scope="col">Status</th><th scope="col">Email</th><th scope="col">Expires</th><th scope="col"><span className="sr-only">Actions</span></th></tr>
        </thead>
        <tbody>
          {links.map((link) => (
            <tr key={link.id}>
              <th scope="row">{link.templateName}</th>
              <td translate="no">{link.recipientEmail}{link.subjectName ? ` · ${link.subjectName}` : ""}</td>
              <td>{linkStateLabel[link.state]}</td>
              <td>{emailDeliveryLabel[link.delivery]}</td>
              <td>{formatDate(link.expiresAt)}</td>
              <td>
                {link.state === "OPEN" && <RevokeClubFormLinkButton linkId={link.id} organizationId={organizationId} />}
                {!link.submissionId && <DeleteClubFormLinkButton formName={link.templateName} linkId={link.id} organizationId={organizationId} />}
                {link.submissionId && <Link className="text-button" href={`${base}/submissions/${link.submissionId}`}>Open form</Link>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function FilledFormsTable({ submissions, base, caption = "Filled forms" }: { submissions: ClubFormSubmissionListRow[]; base: string; caption?: string }) {
  return (
    <div className="report-table-wrap">
      <table className="report-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr><th scope="col">Form</th><th scope="col">Member or subject</th><th scope="col">Status</th><th scope="col">Date</th><th scope="col"><span className="sr-only">Open</span></th></tr>
        </thead>
        <tbody>
          {submissions.map((row) => (
            <tr key={row.id}>
              <th scope="row">{row.templateName}</th>
              <td translate={row.subjectName ? "no" : undefined}>{row.subjectName || "Not named"}</td>
              <td>{row.status === "DRAFT" ? "Draft" : "Submitted"}{row.enteredVia === "LINK" ? " · private link" : row.enteredVia === "OPEN_APPLICATION" ? " · open application" : ""}</td>
              <td>{formatDate(row.submittedAt ?? row.updatedAt)}</td>
              <td>
                <Link className="secondary-button" href={`${base}/submissions/${row.id}`}>
                  {row.status === "DRAFT" ? "Open" : <><Printer aria-hidden="true" size={13} /> View and print</>}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A native collapsible list: the summary names the list and counts it. Open by default. */
export function CollapsibleList({ label, count, children, open = true }: { label: string; count: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details className={styles.details} open={open}>
      <summary className={styles.summary}>{label} <span className={styles.count}>{count}</span></summary>
      {children}
    </details>
  );
}

export function FilledFormsList({ submissions, base, filter, empty }: { submissions: ClubFormSubmissionListRow[]; base: string; filter: React.ReactNode; empty: React.ReactNode }) {
  return (
    <details className={styles.details} open>
      <summary className={styles.summary}><h3>Filled forms</h3> <span className={styles.count}>{plural(submissions.length, "form", "forms")}</span></summary>
      {filter}
      {submissions.length === 0 ? empty : <FilledFormsTable base={base} submissions={submissions} />}
    </details>
  );
}

/** Forms and links from earlier club years, once the club has started the new year: closed until opened. */
export function PastYearsSection({ years, organizationId, base }: { years: PastYearGroup<ClubFormLinkRow, ClubFormSubmissionListRow>[]; organizationId: string; base: string }) {
  return (
    <section aria-labelledby="club-forms-past" className="public-manage-card" data-testid="past-years">
      <details className={styles.details}>
        <summary className={styles.summary}><h3 id="club-forms-past">Past years</h3> <span className={styles.count}>{plural(years.length, "club year", "club years")}</span></summary>
        <p className="field-help">Forms and links from earlier club years. Nothing here was deleted, and the same people can open them.</p>
        <div className={styles.past}>
          {years.map((year) => (
            <details className={styles.year} data-club-year={year.clubYear} key={year.clubYear}>
              <summary className={styles.summary}>{year.clubYear} <span className={styles.count}>{plural(year.submissions.length, "filled form", "filled forms")}, {plural(year.links.length, "link", "links")}</span></summary>
              <div className={styles.yearBody}>
                {year.submissions.length > 0 && (
                  <div>
                    <h4>Filled forms</h4>
                    <FilledFormsTable base={base} caption={`Filled forms, ${year.clubYear}`} submissions={year.submissions} />
                  </div>
                )}
                {year.links.length > 0 && (
                  <div>
                    <h4>Private links</h4>
                    <ClubFormLinksTable base={base} caption={`Private links, ${year.clubYear}`} links={year.links} organizationId={organizationId} />
                  </div>
                )}
              </div>
            </details>
          ))}
        </div>
      </details>
    </section>
  );
}
