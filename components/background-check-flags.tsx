"use client";

import { ExactValue } from "@/components/exact-value";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { formatPersonName } from "@/lib/person-name";
import { useTableSort, type ColumnSpec } from "@/components/use-table-sort";
import { backgroundFlagLabels } from "@/modules/background-checks/display";
import type { BackgroundFlag } from "@/modules/background-checks/repository";

const badgeTitles = {
  MISSING: "No Sterling Volunteers record on file.",
  EXPIRED: "Their Sterling Volunteers record has expired.",
  NOT_COMPLIANT: "The latest roster import marks them not in compliance.",
} as const;

/**
 * The red flag for an adult with no current Sterling Volunteers (#388, #427).
 * Never shown to clubs. An "expiring soon" roster mark still counts as
 * current here, so it is never flagged.
 */
export function BackgroundCheckBadge({ state }: { state?: BackgroundFlag["state"] }) {
  return (
    <span className="status-chip coral background-check-badge" title={badgeTitles[state ?? "MISSING"]}>
      <ShieldAlert aria-hidden="true" size={12} /> Sterling Volunteers needed
    </span>
  );
}

// Sorts from its headers (#1458); the keys here are the whitelist. Only columns already shown are sortable.
const FLAG_SORT: Record<"person" | "club" | "contact" | "check" | "registration", ColumnSpec<BackgroundFlag>> = {
  person: { get: (person) => formatPersonName(person, "sorted"), label: "person" },
  club: { get: (person) => person.clubName, label: "club" },
  contact: { get: (person) => person.contactEmail, label: "contact" },
  check: { get: (person) => backgroundFlagLabels[person.state], label: "check" },
  registration: { get: (person) => person.confirmationCode, label: "registration code" },
};

/**
 * Everyone at a youth or children's event missing a current check. Staff and
 * event managers only. `registrationHref` links a row to the registration.
 */
export function BackgroundCheckList({
  people,
  registrationHref,
  showClub = true,
}: {
  people: BackgroundFlag[];
  registrationHref?: { base: string; query: string };
  showClub?: boolean;
}) {
  const sorted = useTableSort(people, FLAG_SORT, "sterling");
  if (people.length === 0) {
    return <p className="report-empty">Every adult registered is current with Sterling Volunteers.</p>;
  }
  const hasContact = people.some((person) => person.contactEmail);
  return (
    <div className="report-table-wrap">
      {sorted.note}
      <table className="report-table roster-table">
        <caption className="sr-only">Adults needing Sterling Volunteers</caption>
        <thead>
          <tr>
            {sorted.header("person", "Person")}
            {showClub && sorted.header("club", "Club")}
            {hasContact && sorted.header("contact", "Contact")}
            {sorted.header("check", "Check")}
            {sorted.header("registration", "Registration")}
          </tr>
        </thead>
        <tbody>
          {sorted.rows.map((person) => (
            <tr key={person.attendeeId}>
              <th scope="row">
                <ExactValue>{person.lastName}, {person.firstName}</ExactValue>
                <small className="quiet-copy"> · {person.attendeeType}</small>
              </th>
              {showClub && <td translate="no">{person.clubName ?? "—"}</td>}
              {hasContact && <td translate="no">{person.contactEmail ?? "—"}</td>}
              <td>
                <BackgroundCheckBadge state={person.state} />
                <small className="quiet-copy"> {person.state === "EXPIRED" ? `Expired ${person.expiresOn}` : backgroundFlagLabels[person.state]}</small>
                {person.issuesNote && <><br /><small className="quiet-copy background-check-note">Issues: <ExactValue>{person.issuesNote}</ExactValue></small></>}
                {person.issueReasons.length > 0 && <><br /><small className="quiet-copy background-check-note">{person.issueReasons.join("; ")}</small></>}
              </td>
              <td>
                {registrationHref
                  ? <Link className="report-record-link" href={`${registrationHref.base}?${registrationHref.query}&registration=${encodeURIComponent(person.registrationId)}`}>{person.confirmationCode}</Link>
                  : person.confirmationCode}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
