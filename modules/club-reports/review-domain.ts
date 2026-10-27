/**
 * The "Reviewed" mark on monthly records (#1246): pure rules, no database access and no authorization.
 *
 * One record is "to review" when it is submitted (on time or late) and no Clubs Administrator has marked it Reviewed.
 * The dashboard card and the Monthly records list both call `recordsToReview` on the same club summaries, so the
 * count on the card is the length of the list it links to.
 */
import type { AreaClubSummary, MonthStatus } from "@/modules/club-reports/area-summary-domain";

export type RecordState = "NOT_SUBMITTED" | "SUBMITTED" | "REVIEWED";

export const recordStateLabels: Record<RecordState, string> = {
  NOT_SUBMITTED: "Not submitted",
  SUBMITTED: "Submitted",
  REVIEWED: "Reviewed",
};

export function isSubmittedStatus(status: MonthStatus | null | undefined) {
  return status === "SUBMITTED" || status === "LATE";
}

/** Not submitted (a draft, due, missing or not yet due), Submitted, or Reviewed. */
export function recordState(cell: { status: MonthStatus; reviewed?: boolean } | null | undefined): RecordState {
  if (!cell || !isSubmittedStatus(cell.status)) return "NOT_SUBMITTED";
  return cell.reviewed ? "REVIEWED" : "SUBMITTED";
}

export type RecordToReview = { id: string; name: string; church: string; month: string; points: number; late: boolean };

/** Clubs whose record for the month is submitted and not yet reviewed, in the order the clubs came. */
export function recordsToReview(clubs: readonly AreaClubSummary[], month: string): RecordToReview[] {
  return clubs.flatMap((club) => {
    const cell = club.months.find((entry) => entry.month === month);
    if (!cell || recordState(cell) !== "SUBMITTED") return [];
    return [{ id: club.id, name: club.name, church: club.church, month, points: cell.points ?? 0, late: cell.status === "LATE" }];
  });
}

export const REVIEW_FILTER = "to-review";

/** The Monthly records list's address for the records to review in one month and club year. */
export function recordsToReviewHref(clubYear: string, month: string) {
  return `/admin/clubs/reports?year=${encodeURIComponent(clubYear)}&month=${encodeURIComponent(month)}&review=${REVIEW_FILTER}`;
}
