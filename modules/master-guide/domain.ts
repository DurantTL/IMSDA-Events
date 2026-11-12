/**
 * Master Guide candidate tracking (#1698), pure. A club that switched on the optional "Master Guide tracking" feature keeps
 * a list of candidates: who started and when, their mentor, and where they are in the approval chain (club, then Area
 * Coordinator). Only the two age rules and the order of the steps are enforced; the 1 to 3 year program window is shown and
 * flagged, never a reason to refuse. Nothing here holds a birth date: callers pass the age facts they derived, or a calendar
 * date they just opened and do not keep.
 */

import { ageOn, parseCalendarDate } from "@/modules/club-rosters/domain";
import type { ClubCapabilities } from "@/modules/organizations/director-grants-domain";

export const MASTER_GUIDE_FEATURE_KEY = "master-guide-tracking" as const;

/** A candidate must be this old on the start date to be added. */
export const MASTER_GUIDE_MIN_START_AGE = 16;
/** The club may approve only a candidate this old on the approval date. */
export const MASTER_GUIDE_MIN_APPROVAL_AGE = 18;
/** The program runs one to three years from the start date. */
export const MASTER_GUIDE_MIN_YEARS = 1;
export const MASTER_GUIDE_MAX_YEARS = 3;
export const MASTER_GUIDE_MENTOR_MAX_LENGTH = 80;

/** Stored as text and checked here, so a later conference step needs no migration. */
export const MASTER_GUIDE_STATUSES = ["IN_PROGRESS", "CLUB_APPROVED", "AREA_APPROVED"] as const;
export type MasterGuideStatus = (typeof MASTER_GUIDE_STATUSES)[number];

export const masterGuideStatusLabels: Record<MasterGuideStatus, string> = {
  IN_PROGRESS: "Working on the requirements",
  CLUB_APPROVED: "Approved by the club. Waiting for the Area Coordinator.",
  AREA_APPROVED: "Approved by the Area Coordinator.",
};

export function isMasterGuideStatus(value: unknown): value is MasterGuideStatus {
  return typeof value === "string" && (MASTER_GUIDE_STATUSES as readonly string[]).includes(value);
}

export const BIRTH_DATE_NEEDED = "Birth date needed on the roster.";

/** The roster holds a birth date that could not be opened (a key or setup problem), so no age can be worked out. */
export const BIRTH_DATE_UNREADABLE = "unreadable" as const;
export const BIRTH_DATE_UNREADABLE_MESSAGE = "The birth date on the roster could not be read. Ask the conference office.";
export type RosterBirthDate = string | null | typeof BIRTH_DATE_UNREADABLE;

export class MasterGuideError extends Error {
  constructor(
    public readonly code:
      | "NOT_FOUND"
      | "FEATURE_OFF"
      | "NOT_ON_ROSTER"
      | "ALREADY_A_CANDIDATE"
      | "BIRTH_DATE_NEEDED"
      | "BIRTH_DATE_UNREADABLE"
      | "TOO_YOUNG_TO_START"
      | "TOO_YOUNG_TO_APPROVE"
      | "INVALID_DATE"
      | "WRONG_STATUS",
    message: string,
  ) {
    super(message);
    this.name = "MasterGuideError";
  }
}

/** Who manages the list: the club's director and deputy (the roster's birth dates and the club profile are theirs). */
export function canManageMasterGuide(capabilities: Pick<ClubCapabilities, "editProfile" | "seeBirthDates">): boolean {
  return capabilities.editProfile && capabilities.seeBirthDates;
}

/**
 * Whether an Area Coordinator may approve for a club: the club's ministry must be one of the coordinator's (#843), the same
 * rule as every other coordinator page. A club with no kind, or a coordinator with no ministries, is refused.
 */
export function areaCoordinatorMayApproveForClub(ministries: readonly string[], clubKind: string | null | undefined): boolean {
  return typeof clubKind === "string" && ministries.includes(clubKind);
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

/** A calendar date `years` after another (YYYY-MM-DD). A Feb 29 start lands on Mar 1 in a year with no Feb 29, as ages do. */
export function addYears(date: string, years: number): string | null {
  const parsed = parseCalendarDate(date);
  if (!parsed) return null;
  const target = new Date(Date.UTC(parsed.year + years, parsed.month - 1, parsed.day));
  if (target.getUTCMonth() !== parsed.month - 1) {
    return `${parsed.year + years}-03-01`;
  }
  return `${parsed.year + years}-${pad(parsed.month)}-${pad(parsed.day)}`;
}

/** Why this person cannot be added with this start date, or null. `birthDate` is the roster's, opened by the caller. */
export function addProblem(birthDate: RosterBirthDate, startedOn: string): string | null {
  if (!parseCalendarDate(startedOn)) return "Enter a real start date.";
  if (birthDate === BIRTH_DATE_UNREADABLE) return BIRTH_DATE_UNREADABLE_MESSAGE;
  if (!birthDate) return BIRTH_DATE_NEEDED;
  const age = ageOn(birthDate, startedOn);
  if (age === null) return BIRTH_DATE_NEEDED;
  if (age < MASTER_GUIDE_MIN_START_AGE) return `A candidate must be ${MASTER_GUIDE_MIN_START_AGE} or older on the start date.`;
  return null;
}

/** Why the club cannot approve this person on this date, or null. */
export function clubApprovalProblem(birthDate: RosterBirthDate, approvalDate: string): string | null {
  if (birthDate === BIRTH_DATE_UNREADABLE) return BIRTH_DATE_UNREADABLE_MESSAGE;
  if (!birthDate) return BIRTH_DATE_NEEDED;
  const age = ageOn(birthDate, approvalDate);
  if (age === null) return BIRTH_DATE_NEEDED;
  if (age < MASTER_GUIDE_MIN_APPROVAL_AGE) return `A candidate must be ${MASTER_GUIDE_MIN_APPROVAL_AGE} or older on the approval date.`;
  return null;
}

export type MasterGuideWindow = {
  /** Start plus one year. */
  earliestFinish: string;
  /** Start plus three years. */
  latestFinish: string;
  /** The date past the three-year window was judged on (today, or the club approval date once approved). */
  pastWindow: boolean;
};

/**
 * The program window for a start date. `pastWindow` compares the latest finish with the club's approval date once there is
 * one, otherwise with today: it only flags, nothing is refused on it.
 */
export function masterGuideWindow(startedOn: string, today: string, clubApprovedOn: string | null = null): MasterGuideWindow | null {
  const earliestFinish = addYears(startedOn, MASTER_GUIDE_MIN_YEARS);
  const latestFinish = addYears(startedOn, MASTER_GUIDE_MAX_YEARS);
  if (!earliestFinish || !latestFinish) return null;
  return { earliestFinish, latestFinish, pastWindow: (clubApprovedOn ?? today) > latestFinish };
}

/** The one step each status may take next: in order, no skipping, no going back. */
const nextStatus: Record<MasterGuideStatus, MasterGuideStatus | null> = {
  IN_PROGRESS: "CLUB_APPROVED",
  CLUB_APPROVED: "AREA_APPROVED",
  AREA_APPROVED: null,
};

export function canTransition(from: MasterGuideStatus, to: MasterGuideStatus): boolean {
  return nextStatus[from] === to;
}

/** A candidate's start date and mentor change, and the candidate is removed, only while in progress. */
export function isEditable(status: MasterGuideStatus): boolean {
  return status === "IN_PROGRESS";
}

export const MASTER_GUIDE_PATH = "master-guide";

/** A calendar date for display, "Nov 12, 2026", with no time zone shift. */
export function formatMasterGuideDate(date: string | null): string {
  if (!date || !parseCalendarDate(date)) return "";
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
