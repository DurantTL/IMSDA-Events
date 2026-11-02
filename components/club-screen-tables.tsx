"use client";

import Link from "next/link";
import { Fragment } from "react";
import { Phone } from "lucide-react";
import { ClubReportReview } from "@/components/club-report-review";
import { formatPersonName } from "@/lib/person-name";
import { ExactValue } from "@/components/exact-value";
import { NavigationLink } from "@/components/navigation-link";
import { cardCell } from "@/components/table-card-labels";
import { SortOrderNote, SortableHeader } from "@/components/list-sort";
import { useTableSort, type SortSpec } from "@/components/use-table-sort";
import { backgroundFlagLabels } from "@/modules/background-checks/display";
import type { DirectorSterlingPerson } from "@/modules/background-checks/director-follow-up";
import { requirementSummary, type ClubRequiredForms } from "@/modules/club-forms/required-domain";
import { reportMonthLabel } from "@/modules/club-reports/domain";
import type { RecordToReview } from "@/modules/club-reports/review-domain";
import type { WhosMissingRow } from "@/modules/club-reports/whos-missing-what";
import { clubRosterAttendeeTypeLabels } from "@/modules/club-rosters/domain";
import { EMERGENCY_CONTACT_TERM, GUARDIAN_SLOTS, type GuardianRecord } from "@/modules/club-rosters/guardians-domain";
import styles from "./coordinator-whos-missing.module.css";

/**
 * The sortable tables of the club and coordinator screens that are server components (rule B1, #1458). Each takes plain
 * rows from its page (no functions), sorts them in the browser from its column headers with the sort kept in the
 * address, and keeps the order the page gave until a column is chosen. Their headings, counts and help stay in the
 * server component that renders them.
 */

// ---- Who's missing what (coordinator Overview) ------------------------------------------------------------------

const WHOS_MISSING_SORT = {
  club: { label: "Club / church", noteLabel: "club", value: (row) => row.name },
  missing: { label: "Missing", kind: "number", noteLabel: "number of things missing", value: (row) => row.items.length },
  next: { label: "Next step", noteLabel: "next step", value: (row) => row.next.text },
} satisfies Record<string, SortSpec<WhosMissingRow>>;

/** The clubs are listed in priority order (the order `whosMissingWhat` gave); a column header re-sorts them. */
export function WhosMissingTable({ rows }: { rows: readonly WhosMissingRow[] }) {
  const sorted = useTableSort(rows, WHOS_MISSING_SORT, "missing");
  return (
    <div className="report-table-wrap card-box">
      {sorted.noteText && <SortOrderNote>{sorted.noteText}</SortOrderNote>}
      <table className={`report-table table-cards table-cards-tablet ${styles.table}`} role="table">
        <caption className="sr-only">Clubs that are missing something, with the next step for each</caption>
        <thead role="rowgroup">
          <tr role="row">
            <SortableHeader {...sorted.headerProps("club")} />
            <SortableHeader {...sorted.headerProps("missing")} />
            <SortableHeader {...sorted.headerProps("next")} />
          </tr>
        </thead>
        <tbody role="rowgroup">
          {sorted.rows.map((row) => (
            <tr key={row.clubId} role="row">
              <th className="coordinator-club-cell" role="rowheader" scope="row">
                <span translate="no">{row.name}</span>
                {row.church && <small translate="no">{row.church}</small>}
              </th>
              <td {...cardCell("Missing")}>
                <ul className={styles.chips}>
                  {row.items.map((item) => <li key={item.kind}><span className={`status-chip ${item.tone}`}>{item.label}</span></li>)}
                </ul>
              </td>
              <td {...cardCell("Next step")} className={styles.next}>
                {row.next.text}{" "}
                <NavigationLink className="text-button" href={row.next.href}>
                  {row.next.linkLabel}<span className="sr-only">: {row.name}</span>
                </NavigationLink>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- Roster carry-forward status --------------------------------------------------------------------------------

export type NewYearRow = { organizationId: string; name: string; church: string | null; lastYearActive: number; href: string };

const NEW_YEAR_SORT = {
  club: { label: "Club", value: (row) => row.name },
  church: { label: "Church", value: (row) => row.church },
  people: { label: "People last year", kind: "number", noteLabel: "people last year", value: (row) => row.lastYearActive },
} satisfies Record<string, SortSpec<NewYearRow>>;

export function NewYearStatusTable({ rows, caption }: { rows: readonly NewYearRow[]; caption: string }) {
  const sorted = useTableSort(rows, NEW_YEAR_SORT, "newYear");
  return (
    <div className="report-table-wrap">
      {sorted.noteText && <SortOrderNote>{sorted.noteText}</SortOrderNote>}
      <table role="table" className="report-table table-cards">
        <caption className="sr-only">{caption}</caption>
        <thead role="rowgroup">
          <tr role="row">
            <SortableHeader {...sorted.headerProps("club")} />
            <SortableHeader {...sorted.headerProps("church")} />
            <SortableHeader {...sorted.headerProps("people")} />
          </tr>
        </thead>
        <tbody role="rowgroup">
          {sorted.rows.map((club) => (
            <tr role="row" key={club.organizationId}>
              <th role="rowheader" scope="row" translate="no"><Link href={club.href}>{club.name}</Link></th>
              <td data-label="Church" translate="no">{club.church ?? "—"}</td>
              <td data-label="People last year">{club.lastYearActive}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- Monthly records to review ----------------------------------------------------------------------------------

const RECORDS_TO_REVIEW_SORT = {
  club: { label: "Club", value: (row) => row.name },
  points: { label: "Points", kind: "number", value: (row) => row.points },
} satisfies Record<string, SortSpec<RecordToReview>>;

export function RecordsToReviewTable({ rows, month }: { rows: readonly RecordToReview[]; month: string }) {
  const sorted = useTableSort(rows, RECORDS_TO_REVIEW_SORT, "review");
  return (
    <div className="report-table-wrap">
      {sorted.noteText && <SortOrderNote>{sorted.noteText}</SortOrderNote>}
      <table role="table" className="report-table table-cards">
        <caption className="sr-only">{`Monthly records to review for ${reportMonthLabel(month)}`}</caption>
        <thead role="rowgroup">
          <tr role="row">
            <SortableHeader {...sorted.headerProps("club")} />
            <SortableHeader {...sorted.headerProps("points")} />
            <th role="columnheader" scope="col">Open</th>
            <th role="columnheader" scope="col">Review</th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {sorted.rows.map((row) => (
            <tr role="row" key={row.id}>
              <th role="rowheader" scope="row" translate="no">{row.name}{row.church && <small> ({row.church})</small>}</th>
              <td {...cardCell("Points")}>{row.points}{row.late && <small> late</small>}</td>
              <td {...cardCell("Open")}>
                <Link className="secondary-button" href={`/admin/clubs/reports/${encodeURIComponent(row.id)}/${row.month}`}>Open<span className="sr-only">{` ${row.name} record`}</span></Link>
              </td>
              <td {...cardCell("Review")}><ClubReportReview clubName={row.name} compact month={row.month} organizationId={row.id} reviewed={false} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- Clubs with forms missing -----------------------------------------------------------------------------------

const FORMS_MISSING_SORT = {
  club: { label: "Club", value: (club) => club.name },
  missing: { label: "Missing", kind: "number", noteLabel: "number of forms missing", value: (club) => club.items.length },
} satisfies Record<string, SortSpec<ClubRequiredForms>>;

export function FormsMissingTable({ clubs, clubYear }: { clubs: readonly ClubRequiredForms[]; clubYear: string }) {
  const sorted = useTableSort(clubs, FORMS_MISSING_SORT, "formsMissing");
  return (
    <div className="report-table-wrap">
      {sorted.noteText && <SortOrderNote>{sorted.noteText}</SortOrderNote>}
      <table role="table" className="report-table table-cards">
        <caption className="sr-only">Clubs with forms missing, club year {clubYear}</caption>
        <thead role="rowgroup">
          <tr role="row">
            <SortableHeader {...sorted.headerProps("club")} />
            <SortableHeader {...sorted.headerProps("missing")} />
            <th role="columnheader" scope="col">Open club</th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {sorted.rows.map((club) => (
            <tr role="row" key={club.id}>
              <th role="rowheader" scope="row" translate="no">{club.name}{club.church && <small> ({club.church})</small>}</th>
              <td {...cardCell("Missing")}>
                <ul className="forms-missing-list">
                  {club.items.map((item) => (
                    <li key={item.templateKey}>
                      {item.name}
                      <small className="quiet-copy">
                        {" · "}
                        {item.requirement === "PER_ROLE_MEMBER_YEAR"
                          ? `${item.missingMembers.length} of ${item.memberCount} ${item.memberCount === 1 ? "member" : "members"} (${requirementSummary(item.requirement, item.roles)})`
                          : "club form not submitted"}
                      </small>
                    </li>
                  ))}
                </ul>
              </td>
              <td {...cardCell("Open club")}>
                <Link className="secondary-button" href={`/admin/organizations/${encodeURIComponent(club.id)}/club`}>Open club<span className="sr-only"> {club.name}</span></Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- A director's Sterling Volunteers follow-up -----------------------------------------------------------------

const STERLING_SORT = {
  person: { label: "Person", value: (person) => formatPersonName(person, "sorted") },
  status: { label: "Status", value: (person) => backgroundFlagLabels[person.state] },
} satisfies Record<string, SortSpec<DirectorSterlingPerson>>;

export function SterlingFollowUpTable({ people }: { people: readonly DirectorSterlingPerson[] }) {
  const sorted = useTableSort(people, STERLING_SORT, "sterling");
  return (
    <div className="report-table-wrap">
      {sorted.noteText && <SortOrderNote>{sorted.noteText}</SortOrderNote>}
      <table className="report-table roster-table">
        <caption className="sr-only">Registered adults and staff who are not current with Sterling Volunteers</caption>
        <thead>
          <tr>
            <SortableHeader {...sorted.headerProps("person")} />
            <SortableHeader {...sorted.headerProps("status")} />
          </tr>
        </thead>
        <tbody>
          {sorted.rows.map((person) => (
            <tr key={person.attendeeId}>
              <th scope="row">
                <ExactValue>{person.lastName}, {person.firstName}</ExactValue>
                <small className="quiet-copy"> · {person.attendeeType}</small>
              </th>
              <td>{backgroundFlagLabels[person.state]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- A club's emergency contacts --------------------------------------------------------------------------------

export type GuardianTableRow = { memberId: string; firstName: string; lastName: string; attendeeType: string; guardians: GuardianRecord[] };

const contactName = (row: GuardianTableRow, position: number) => row.guardians.find((guardian) => guardian.position === position)?.name;
const GUARDIAN_SORT = {
  member: { label: "Member", value: (row) => formatPersonName(row, "sorted") },
  contact1: { label: "Contact 1", noteLabel: "first contact", value: (row) => contactName(row, 1) },
  contact2: { label: "Contact 2", noteLabel: "second contact", value: (row) => contactName(row, 2) },
} satisfies Record<string, SortSpec<GuardianTableRow>>;
const GUARDIAN_COLUMNS = ["contact1", "contact2"] as const;

export function GuardiansTable({ contacts }: { contacts: readonly GuardianTableRow[] }) {
  const sorted = useTableSort(contacts, GUARDIAN_SORT, "guardians");
  return (
    <div className="club-guardians-table-wrap report-table-wrap">
      {sorted.noteText && <SortOrderNote>{sorted.noteText}</SortOrderNote>}
      <table className="report-table">
        <thead>
          <tr>
            <SortableHeader {...sorted.headerProps("member")} />
            {GUARDIAN_COLUMNS.slice(0, GUARDIAN_SLOTS).map((column) => <Fragment key={column}><SortableHeader {...sorted.headerProps(column)} /></Fragment>)}
          </tr>
        </thead>
        <tbody>
          {sorted.rows.map((contact) => (
            <tr key={contact.memberId}>
              <th scope="row">
                <span translate="no">{contact.firstName} {contact.lastName}</span>
                <small> · {clubRosterAttendeeTypeLabels[contact.attendeeType as keyof typeof clubRosterAttendeeTypeLabels] ?? contact.attendeeType}</small>
              </th>
              {Array.from({ length: GUARDIAN_SLOTS }, (_, index) => (
                <td key={index}><GuardianCell guardian={contact.guardians.find((guardian) => guardian.position === index + 1)} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GuardianCell({ guardian }: { guardian: GuardianRecord | undefined }) {
  if (!guardian) return <span className="quiet-copy">None on file</span>;
  return (
    <span className="club-guardian-cell">
      <small className="club-guardian-term">{EMERGENCY_CONTACT_TERM.singular}</small>
      <strong translate={guardian.name ? "no" : undefined}>{guardian.name || "Name not given"}</strong>
      {guardian.relationship && <small>{guardian.relationship}</small>}
      {guardian.phone && <a href={`tel:${guardian.phone.replace(/[^0-9+]/g, "")}`} translate="no"><Phone aria-hidden="true" size={12} /> {guardian.phone}</a>}
      {guardian.email && <a href={`mailto:${guardian.email}`} translate="no">{guardian.email}</a>}
    </span>
  );
}
