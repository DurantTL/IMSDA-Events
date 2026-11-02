"use client";

import Link from "next/link";
import { Printer } from "lucide-react";
import { SortOrderNote, SortableHeader, useAddressSort } from "@/components/list-sort";
import { sortOrderText, sortRows, type SortKind, type SortState, type SortValue } from "@/lib/list-sort";
import { DeleteClubFormLinkButton, RevokeClubFormLinkButton } from "@/components/club-forms-actions";
import type { PastYearGroup } from "@/modules/club-forms/past-years-domain";
import type { ClubFormLinkRow } from "@/modules/club-forms/links";
import type { ClubFormSubmissionListRow } from "@/modules/club-forms/submissions";
import type { StatusWord } from "@/modules/registrations/status-words";
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

const linkStateLabel = { OPEN: "Draft", USED: "Submitted", REVOKED: "Cancelled", EXPIRED: "Expired" } as const satisfies Record<ClubFormLinkRow["state"], StatusWord | "Expired">;

/** Both tables sort in the address (#1458); a second table on the page (a past year) passes its own `sortPrefix`, so the two do not share a sort. */
const LINK_SORT_COLUMNS = ["form", "sentTo", "status", "email", "expires"] as const;
type LinkSortColumn = typeof LINK_SORT_COLUMNS[number];
const NO_SORT_LINKS: SortState<LinkSortColumn> = { key: null, dir: "asc" };
const linkAccessors: Record<LinkSortColumn, (link: ClubFormLinkRow) => SortValue> = {
  form: (link) => link.templateName,
  sentTo: (link) => link.recipientEmail,
  status: (link) => linkStateLabel[link.state],
  email: (link) => emailDeliveryLabel[link.delivery],
  expires: (link) => link.expiresAt,
};
const LINK_SORT_LABELS: Record<LinkSortColumn, { label: string; kind: SortKind }> = {
  form: { label: "form", kind: "text" }, sentTo: { label: "recipient", kind: "text" }, status: { label: "status", kind: "text" },
  email: { label: "email status", kind: "text" }, expires: { label: "expiry date", kind: "date" },
};

const FILLED_SORT_COLUMNS = ["form", "subject", "status", "date"] as const;
type FilledSortColumn = typeof FILLED_SORT_COLUMNS[number];
const NO_SORT_FILLED: SortState<FilledSortColumn> = { key: null, dir: "asc" };
const filledAccessors: Record<FilledSortColumn, (row: ClubFormSubmissionListRow) => SortValue> = {
  form: (row) => row.templateName,
  subject: (row) => row.subjectName,
  status: (row) => (row.status === "DRAFT" ? "Draft" : "Submitted"),
  date: (row) => row.submittedAt ?? row.updatedAt,
};
const FILLED_SORT_LABELS: Record<FilledSortColumn, { label: string; kind: SortKind }> = {
  form: { label: "form", kind: "text" }, subject: { label: "member or subject", kind: "text" }, status: { label: "status", kind: "text" }, date: { label: "date", kind: "date" },
};
// Always prefixed ("linksSort", "filledSort"), since the Forms page shows both tables, and "form" is a column of each.
const prefixFor = (sortPrefix: string | undefined, table: string) => `${(sortPrefix ?? "").replace(/[^A-Za-z0-9]/g, "")}${table}`;

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export function ClubFormLinksTable({ links, organizationId, base, caption = "Private links", sortPrefix }: { links: ClubFormLinkRow[]; organizationId: string; base: string; caption?: string; sortPrefix?: string }) {
  const sort = useAddressSort(LINK_SORT_COLUMNS, NO_SORT_LINKS, undefined, prefixFor(sortPrefix, "links"));
  const rows = sort.key ? sortRows(links, sort.key, sort.dir, linkAccessors) : links;
  const header = (column: LinkSortColumn, label: string) => <SortableHeader active={sort.key === column} direction={sort.dir} label={label} onSort={() => sort.toggle(column)} />;
  return (
    <div className="report-table-wrap">
      {sort.key && <SortOrderNote>{sortOrderText(LINK_SORT_LABELS[sort.key].label, sort.dir, LINK_SORT_LABELS[sort.key].kind)}</SortOrderNote>}
      <table className="report-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>{header("form", "Form")}{header("sentTo", "Sent to")}{header("status", "Status")}{header("email", "Email")}{header("expires", "Expires")}<th scope="col"><span className="sr-only">Actions</span></th></tr>
        </thead>
        <tbody>
          {rows.map((link) => (
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

export function FilledFormsTable({ submissions, base, caption = "Filled forms", sortPrefix }: { submissions: ClubFormSubmissionListRow[]; base: string; caption?: string; sortPrefix?: string }) {
  const sort = useAddressSort(FILLED_SORT_COLUMNS, NO_SORT_FILLED, undefined, prefixFor(sortPrefix, "filled"));
  const rows = sort.key ? sortRows(submissions, sort.key, sort.dir, filledAccessors) : submissions;
  const header = (column: FilledSortColumn, label: string) => <SortableHeader active={sort.key === column} direction={sort.dir} label={label} onSort={() => sort.toggle(column)} />;
  return (
    <div className="report-table-wrap">
      {sort.key && <SortOrderNote>{sortOrderText(FILLED_SORT_LABELS[sort.key].label, sort.dir, FILLED_SORT_LABELS[sort.key].kind)}</SortOrderNote>}
      <table className="report-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>{header("form", "Form")}{header("subject", "Member or subject")}{header("status", "Status")}{header("date", "Date")}<th scope="col"><span className="sr-only">Open</span></th></tr>
        </thead>
        <tbody>
          {rows.map((row) => (
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
                    <FilledFormsTable base={base} caption={`Filled forms, ${year.clubYear}`} sortPrefix={year.clubYear} submissions={year.submissions} />
                  </div>
                )}
                {year.links.length > 0 && (
                  <div>
                    <h4>Private links</h4>
                    <ClubFormLinksTable base={base} caption={`Private links, ${year.clubYear}`} links={year.links} organizationId={organizationId} sortPrefix={year.clubYear} />
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
