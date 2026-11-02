"use client";

import { ExportLink } from "@/components/export-link";
import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { SortOrderNote, SortableHeader } from "@/components/list-sort";
import { useTableSort, type SortSpec } from "@/components/use-table-sort";
import { Download } from "lucide-react";
import { clubYearMonths, isLockedForClub, monthNotDueForClub, yearToDate } from "@/modules/club-reports/domain";
import type { ClubYearSummary } from "@/modules/club-reports/repository";
import { cardCell } from "@/components/table-card-labels";

const shortMonth = (month: string) => new Date(`${month}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });

/** Every club's monthly points for a club year (#377): missing reports, the registration bonus, and year to date. */
export function ClubReportsConference({
  clubYear,
  initialClubs,
  now,
  viewOnlyReportHref,
}: {
  clubYear: string;
  initialClubs: ClubYearSummary[];
  now: string;
  /**
   * Event managers (#387) see this view only: no export, no registration
   * ticks, and only submitted reports open, at this address.
   */
  viewOnlyReportHref?: { base: string; query: string };
}) {
  const viewOnly = Boolean(viewOnlyReportHref);
  const [clubs, setClubs] = useState(initialClubs);
  const [error, setError] = useState("");
  const months = clubYearMonths(clubYear);
  const today = new Date(now);
  // Sortable from the headers (#1458): the club, each month of this club year, the registration tick and the year to date.
  // The month columns come from the club year, so the address can only name a month that is on this table.
  const sortSpec = useMemo(() => {
    const spec: Record<string, SortSpec<ClubYearSummary>> = {
      club: { label: "Club", value: (club) => club.name },
      registration: { label: "Yearly registration", noteLabel: "yearly registration", value: (club) => club.registrationOnTime },
      ytd: { label: "Year to date", kind: "number", value: (club) => yearToDate(Object.values(club.reports), club.registrationOnTime) },
    };
    for (const month of months) spec[`month-${month}`] = { label: shortMonth(month), kind: "number", noteLabel: `${shortMonth(month)} points`, value: (club) => club.reports[month]?.totalPoints };
    return spec;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `months` is a pure function of `clubYear`.
  }, [clubYear]);
  const sorted = useTableSort(clubs, sortSpec, "records");

  async function toggleRegistration(club: ClubYearSummary, registrationOnTime: boolean) {
    setError("");
    setClubs((current) => current.map((item) => (item.id === club.id ? { ...item, registrationOnTime } : item)));
    const response = await fetch("/api/admin/club-reports/standing", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId: club.id, clubYear, registrationOnTime }),
    });
    if (!response.ok) {
      setClubs((current) => current.map((item) => (item.id === club.id ? { ...item, registrationOnTime: !registrationOnTime } : item)));
      const result = await response.json().catch(() => ({})) as { message?: string };
      setError(result.message ?? "The registration standing could not be saved.");
    }
  }

  const missingTotal = clubs.reduce((sum, club) => sum + months.filter((month) => !club.reports[month] && !monthNotDueForClub(month, club.joinedOn, false) && isLockedForClub(month, today)).length, 0);

  return (
    <section className="page-stack">
      <div className="page-intro">
        <div>
          <p className="eyebrow">{`Clubs · ${clubYear}`}</p>
          <h2>Monthly Records</h2>
          <p>
            Points per club and month. <strong>Missing</strong> means the due date (the 10th of the next month) has passed with no
            report. Tick <em>Registration</em> when a club&apos;s yearly registration came in on time; it adds 1,500 points.
            {viewOnly ? "Select a submitted month to view that report." : "Select a month to open or file that report."}
          </p>
        </div>
        {!viewOnly && (
          <div className="intro-actions">
            <ExportLink className="secondary-button" href={`/api/admin/club-reports/export?year=${encodeURIComponent(clubYear)}`}>
              <Download aria-hidden="true" size={15} /> Download CSV
            </ExportLink>
          </div>
        )}
      </div>
      {error && <div className="inline-notice error" role="alert">{error}</div>}
      <p className="field-help">{`${clubs.length} active clubs · ${missingTotal} missing reports so far.`}</p>
      {clubs.length === 0 ? (
        <div className="panel"><p className="report-empty">No active clubs yet.</p></div>
      ) : (
        <div className="report-table-wrap club-reports-grid">
          {sorted.noteText && <SortOrderNote>{sorted.noteText}</SortOrderNote>}
          <table role="table" className="report-table table-cards table-cards-xwide">
            <caption className="sr-only">{`Monthly Record points by club for ${clubYear}`}</caption>
            <thead role="rowgroup">
              <tr role="row">
                <SortableHeader {...sorted.headerProps("club")} />
                {months.map((month) => <Fragment key={month}><SortableHeader {...sorted.headerProps(`month-${month}`)} /></Fragment>)}
                <SortableHeader {...sorted.headerProps("registration")} />
                <SortableHeader {...sorted.headerProps("ytd")} />
              </tr>
            </thead>
            <tbody role="rowgroup">
              {sorted.rows.map((club) => (
                <tr role="row" key={club.id}>
                  <th role="rowheader" scope="row" translate="no">{club.name}{club.church && <small>{club.church}</small>}</th>
                  {months.map((month) => {
                    const report = club.reports[month];
                    // A month before a new club joined is shown like a future month: nothing is owed for it (#1410).
                    const future = month > now.slice(0, 7) || monthNotDueForClub(month, club.joinedOn, false);
                    const href = viewOnlyReportHref
                      ? `${viewOnlyReportHref.base}/${encodeURIComponent(club.id)}/${month}${viewOnlyReportHref.query}`
                      : `/admin/clubs/reports/${encodeURIComponent(club.id)}/${month}`;
                    if (report) {
                      return <td key={month} {...cardCell(shortMonth(month))}><Link href={href}>{report.totalPoints}</Link>{!report.onTime && <small> late</small>}{report.reviewed && <small> reviewed</small>}</td>;
                    }
                    if (future) return <td key={month} {...cardCell(shortMonth(month))} className="club-reports-future">—</td>;
                    if (viewOnly) {
                      return <td key={month} {...cardCell(shortMonth(month))} className={isLockedForClub(month, today) ? "club-reports-missing" : "club-reports-due"}>{isLockedForClub(month, today) ? "Missing" : "Due"}</td>;
                    }
                    return (
                      <td key={month} {...cardCell(shortMonth(month))}>
                        {isLockedForClub(month, today)
                          ? <Link className="club-reports-missing" href={href}>Missing</Link>
                          : <Link className="club-reports-due" href={href}>Due</Link>}
                      </td>
                    );
                  })}
                  <td {...cardCell("Yearly registration")}>
                    {viewOnly
                      ? (club.registrationOnTime ? "On time" : "—")
                      : (
                        <label className="checkbox-hit">
                          <input
                            aria-label={`${club.name} yearly registration on time`}
                            checked={club.registrationOnTime}
                            onChange={(event) => void toggleRegistration(club, event.target.checked)}
                            type="checkbox"
                          />
                        </label>
                      )}
                  </td>
                  <td {...cardCell("Year to date")}><strong>{yearToDate(Object.values(club.reports), club.registrationOnTime).toLocaleString("en-US")}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
