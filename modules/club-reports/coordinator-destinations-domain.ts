import type { AreaClubSummary } from "@/modules/club-reports/area-summary-domain";
import { clubRecordStatus, type ClubRecordStatus } from "@/modules/club-reports/coordinator-overview-domain";
import { YEARLY_REGISTRATION_POINTS, reportMonthLabel } from "@/modules/club-reports/domain";

/**
 * Pure helpers for the coordinator destination pages (#1187): Monthly Records,
 * Points and Club events. They only reshape the clubs `getAreaClubsSummary`
 * already returned. They authorize nothing, score nothing and change no export.
 */

/** One month of one club, in the Overview's own words (Submitted / Not submitted / Not due yet). */
export type MonthlyRecordCell = { month: string; label: string; short: string; status: ClubRecordStatus };

const shortMonthLabel = (month: string) => new Date(`${month}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });

export function monthlyRecordCells(club: AreaClubSummary, now: Date): MonthlyRecordCell[] {
  return club.months.map((cell) => ({
    month: cell.month,
    label: reportMonthLabel(cell.month),
    short: shortMonthLabel(cell.month),
    status: clubRecordStatus(club, cell.month, now),
  }));
}

/** Submitted and Not submitted months for one club. A month that is not due yet is neither. */
export function monthlyRecordCounts(club: AreaClubSummary, now: Date) {
  const cells = monthlyRecordCells(club, now);
  return {
    submitted: cells.filter((cell) => cell.status.state === "SUBMITTED").length,
    notSubmitted: cells.filter((cell) => cell.status.state === "NOT_SUBMITTED").length,
  };
}

/** The submitted months a club's points rest on: each one has a record the coordinator may open, read only. */
export function supportingRecordMonths(club: AreaClubSummary): Array<{ month: string; label: string; short: string }> {
  return club.months
    .filter((cell) => cell.status === "SUBMITTED" || cell.status === "LATE")
    .map((cell) => ({ month: cell.month, label: reportMonthLabel(cell.month), short: shortMonthLabel(cell.month) }));
}

/** What the Monthly Records page says about the states, so none of them reads as an approval or a deadline policy. */
export const MONTHLY_RECORDS_HELP =
  "Submitted means the club filed that month's record; select it to read it. Not submitted means the month has ended and no record is filed. Not due yet means the month has not ended. These are record states, not approvals. Records are due on the 10th of the next month.";

/** Points: what is recorded and what the system adds, in plain words. The scoring itself is unchanged. */
export const POINTS_HELP =
  `Recorded report points are the totals on each submitted Monthly Record. Yearly registration points (${YEARLY_REGISTRATION_POINTS.toLocaleString("en-US")}) are added for an on-time yearly registration and are not part of any record. Total points are the two together.`;

/** Club events: the coordinator's actions are views. Payments are not handled here, whoever is billed. */
export const CLUB_EVENTS_ACTIONS_TEXT =
  "From here you can open a club or an event's kitchen report. You cannot register a club, change a registration or pay a balance, including for an event a church is billed for.";

/** New clubs: who decides. */
export const NEW_CLUBS_DECISION_TEXT =
  "System administrators make the approve and decline decisions. This list is view only.";

/** Team approvals: who may decide. */
export const TEAM_APPROVALS_STAFF_TEXT =
  "A staff act-as view cannot approve or decline. Team approvals are decided by the Area Coordinator for their own event locations, or by event staff in Team results.";
