/**
 * Optional club features (#1709), pure. A club switches an optional feature on in Club settings; every feature is off
 * by default, so a club that never switches one on sees nothing new. The keys are this typed list, not free text.
 *
 * Roster health flags: a computed list of who on the active roster is missing something or has an old record. Nothing
 * here is stored per person, and nothing here ever carries the content of a health record, a contact or a check:
 * only that something is missing or old.
 */

import type { ClubCapabilities } from "@/modules/organizations/director-grants-domain";

export const CLUB_OPTIONAL_FEATURE_KEYS = ["roster-health-flags"] as const;
export type ClubOptionalFeatureKey = (typeof CLUB_OPTIONAL_FEATURE_KEYS)[number];

export const clubOptionalFeatureDefinitions: Record<ClubOptionalFeatureKey, { title: string; description: string }> = {
  "roster-health-flags": {
    title: "Roster health flags",
    description: "Lists the people on your roster whose record is over a year old or who are missing an emergency contact, a health record, a photo release or a Sterling Volunteers check, with counts on your club Home. It only says that something is missing; it never shows what is in a record.",
  },
};

export function isClubOptionalFeatureKey(value: unknown): value is ClubOptionalFeatureKey {
  return typeof value === "string" && (CLUB_OPTIONAL_FEATURE_KEYS as readonly string[]).includes(value);
}

/**
 * Who may switch an optional feature on or off: the club's director and deputy, the same capability that edits the club
 * profile on Club settings. A registrar and a reporter cannot, and nobody outside the club (an Area Coordinator, staff)
 * has a way in.
 */
export function canSwitchClubFeatures(capabilities: Pick<ClubCapabilities, "editProfile">): boolean {
  return capabilities.editProfile;
}

/**
 * Who sees the roster health list: the club's director and deputy only. It combines three things that are each already
 * limited to them (emergency contacts, a Sterling status per adult, full roster detail), so it needs all three and can
 * never show a viewer more than the pages those come from. Area Coordinators and staff have no way into this page.
 */
export function canSeeRosterHealth(capabilities: Pick<ClubCapabilities, "editProfile" | "guardians" | "seeBirthDates">): boolean {
  return capabilities.editProfile && capabilities.guardians && capabilities.seeBirthDates;
}

export const ROSTER_HEALTH_FLAGS = ["OUTDATED", "NO_EMERGENCY_CONTACT", "NO_HEALTH_RECORD", "NO_PHOTO_RELEASE", "NO_STERLING_CHECK"] as const;
export type RosterHealthFlag = (typeof ROSTER_HEALTH_FLAGS)[number];

export const rosterHealthFlagLabels: Record<RosterHealthFlag, string> = {
  OUTDATED: "Not updated in over a year",
  NO_EMERGENCY_CONTACT: "No emergency contact",
  NO_HEALTH_RECORD: "No health record",
  NO_PHOTO_RELEASE: "No photo release",
  NO_STERLING_CHECK: "No Sterling check",
};

/** The short names used on the Home counts and the column of the list. */
export const rosterHealthFlagCountLabels: Record<RosterHealthFlag, string> = {
  OUTDATED: "Not updated in a year",
  NO_EMERGENCY_CONTACT: "No emergency contact",
  NO_HEALTH_RECORD: "No health record",
  NO_PHOTO_RELEASE: "No photo release",
  NO_STERLING_CHECK: "No Sterling check",
};

/** The template whose submitted form is a member's photo release (#1221). */
export const PHOTO_RELEASE_TEMPLATE_KEY = "pathfinder_photo_video_release";

/** A photo release is a parent or guardian's, for a minor: only these roster types are asked for one. */
const PHOTO_RELEASE_TYPES: readonly string[] = ["YOUTH", "UNDERAGE"];
/** The Sterling Volunteers check is for adults: the roster's own rule for who gets a status (`clubRosterComplianceStatuses`). */
const STERLING_TYPES: readonly string[] = ["ADULT", "STAFF"];

export function photoReleaseApplies(attendeeType: string) {
  return PHOTO_RELEASE_TYPES.includes(attendeeType);
}

export function sterlingApplies(attendeeType: string) {
  return STERLING_TYPES.includes(attendeeType);
}

/** A row edited at least this long after it was created counts as edited. A carried-forward or imported row is written once. */
const EDIT_GAP_MS = 60_000;

type Stamped = { createdAt: Date; updatedAt: Date };

/**
 * When the person's record was last meaningfully updated. The roster row's `updatedAt` alone would be wrong: carrying the
 * roster forward each August creates a fresh row, which would make everyone look updated that day. So this is the latest
 * time a roster row of that person in this club, or one of their emergency contacts, was edited after it was written
 * (`updatedAt` more than a minute past `createdAt`), over every year. A person never edited since they were first entered
 * is dated by the earliest row (when they were first added).
 */
export function lastMeaningfulUpdate(rows: readonly Stamped[], contacts: readonly Stamped[]): Date | null {
  const all = [...rows, ...contacts];
  if (all.length === 0) return null;
  const edited = all.filter((row) => row.updatedAt.getTime() - row.createdAt.getTime() > EDIT_GAP_MS).map((row) => row.updatedAt.getTime());
  if (edited.length > 0) return new Date(Math.max(...edited));
  return new Date(Math.min(...rows.map((row) => row.createdAt.getTime()), ...contacts.map((row) => row.createdAt.getTime())));
}

/** The moment a year before `now`: a record last updated before it is "over a year" old. */
export function outdatedBefore(now: Date): Date {
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  return cutoff;
}

export type RosterHealthInput = {
  attendeeType: string;
  lastUpdated: Date | null;
  hasEmergencyContact: boolean;
  /** Null: not checked (the Health Record feature is off), so nothing is flagged. */
  hasHealthRecord: boolean | null;
  /** Null: not checked (the photo release form is not turned on). */
  hasPhotoRelease: boolean | null;
  /** The Sterling state is "no record on file". Null: not an adult, so not asked. */
  noSterlingCheck: boolean | null;
};

/** What is missing or old for one person, in a fixed order. Empty means nothing to flag. */
export function rosterHealthFlags(input: RosterHealthInput, now: Date): RosterHealthFlag[] {
  const flags: RosterHealthFlag[] = [];
  if (input.lastUpdated && input.lastUpdated.getTime() < outdatedBefore(now).getTime()) flags.push("OUTDATED");
  if (!input.hasEmergencyContact) flags.push("NO_EMERGENCY_CONTACT");
  if (input.hasHealthRecord === false) flags.push("NO_HEALTH_RECORD");
  if (input.hasPhotoRelease === false && photoReleaseApplies(input.attendeeType)) flags.push("NO_PHOTO_RELEASE");
  if (input.noSterlingCheck === true && sterlingApplies(input.attendeeType)) flags.push("NO_STERLING_CHECK");
  return flags;
}

export type RosterHealthCounts = { people: number; flagged: number; byFlag: Record<RosterHealthFlag, number> };

/** Counts for Home: the active people checked, how many have at least one flag, and how many have each. */
export function rosterHealthCounts(rows: ReadonlyArray<{ flags: readonly RosterHealthFlag[] }>): RosterHealthCounts {
  const byFlag = Object.fromEntries(ROSTER_HEALTH_FLAGS.map((flag) => [flag, 0])) as Record<RosterHealthFlag, number>;
  let flagged = 0;
  for (const row of rows) {
    if (row.flags.length > 0) flagged += 1;
    for (const flag of row.flags) byFlag[flag] += 1;
  }
  return { people: rows.length, flagged, byFlag };
}

export const ROSTER_HEALTH_PATH = "roster-health";
