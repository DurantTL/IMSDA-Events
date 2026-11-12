/**
 * Staff training records (#1697), pure. An optional club feature: a club's director or deputy records, for each adult on
 * the club's roster, the NAD certification levels they hold and the workshops they have taken. Nothing here is required
 * of a club, and a club that never switches the feature on has no records and sees nothing new.
 *
 * The certification levels are data in this file, not a database enum, so a change to the list is a code change with no
 * migration. A workshop is a code and a title the club types; the authoritative NAD workshop list is a later slice.
 * Nothing sensitive is stored: no health, contact or identity detail, only what was completed, when, and who signed off.
 */

import type { ClubCapabilities } from "@/modules/organizations/director-grants-domain";

export const STAFF_TRAINING_FEATURE_KEY = "staff-training-records";
export const STAFF_TRAINING_PATH = "staff-training";

export const STAFF_TRAINING_KINDS = ["CERTIFICATION", "WORKSHOP"] as const;
export type StaffTrainingKind = (typeof STAFF_TRAINING_KINDS)[number];

export const staffTrainingKindLabels: Record<StaffTrainingKind, string> = {
  CERTIFICATION: "Certification",
  WORKSHOP: "Workshop",
};

/** The NAD certification levels, in the order they are offered. */
export const NAD_CERTIFICATIONS = [
  { key: "BASIC_STAFF", label: "Basic Staff" },
  { key: "INSTRUCTOR", label: "Instructor" },
  { key: "COUNSELOR", label: "Counselor" },
  { key: "SECRETARY_TREASURER", label: "Secretary/Treasurer" },
  { key: "DIRECTOR", label: "Director" },
] as const;

export type NadCertificationKey = (typeof NAD_CERTIFICATIONS)[number]["key"];
export const NAD_CERTIFICATION_KEYS = NAD_CERTIFICATIONS.map((item) => item.key) as [NadCertificationKey, ...NadCertificationKey[]];

export function isNadCertificationKey(value: unknown): value is NadCertificationKey {
  return typeof value === "string" && (NAD_CERTIFICATION_KEYS as readonly string[]).includes(value);
}

export function certificationLabel(key: string | null | undefined): string {
  return NAD_CERTIFICATIONS.find((item) => item.key === key)?.label ?? "Unknown certification";
}

/**
 * Who may view and edit staff training records: the club's director and deputy, the same capability that edits the club
 * profile and switches optional features. A registrar and a reporter cannot. Area Coordinators and conference staff have
 * no way in (the conference view across clubs is a later slice); staff acting as the club's director count as the director.
 */
export function canManageStaffTraining(capabilities: Pick<ClubCapabilities, "editProfile">): boolean {
  return capabilities.editProfile;
}

/** The roster types that can hold a record: adults and staff, the same people the Sterling Volunteers check covers. */
export const STAFF_TRAINING_ATTENDEE_TYPES = ["ADULT", "STAFF"] as const;

export function staffTrainingApplies(attendeeType: string): boolean {
  return (STAFF_TRAINING_ATTENDEE_TYPES as readonly string[]).includes(attendeeType);
}

export const WORKSHOP_CODE_MAX = 20;
export const WORKSHOP_TITLE_MAX = 120;
export const SIGNED_OFF_BY_MAX = 80;

/** `YYYY-MM-DD` that is a real calendar date. */
export function isRealIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** The earliest date a record may carry; before this is almost certainly a typing slip. */
export const EARLIEST_COMPLETED_ON = "1970-01-01";

/**
 * Why a completed date is not acceptable, or null. A date in the future cannot have been completed yet. A day of
 * leeway covers a club whose clock is a time zone ahead of the server's.
 */
export function completedOnProblem(value: string, now: Date): string | null {
  if (!isRealIsoDate(value)) return "Enter the date as year, month and day.";
  if (value < EARLIEST_COMPLETED_ON) return "That date is too long ago.";
  const latest = new Date(now.getTime() + 24 * 3_600_000).toISOString().slice(0, 10);
  if (value > latest) return "The date can't be in the future.";
  return null;
}

export type StaffTrainingRecordView = {
  id: string;
  kind: StaffTrainingKind;
  /** The certification's name, or the workshop's "CODE title". */
  label: string;
  certificationKey: NadCertificationKey | null;
  workshopCode: string | null;
  workshopTitle: string | null;
  /** `YYYY-MM-DD`. */
  completedOn: string;
  signedOffBy: string | null;
};

/** Newest completed date first; the same day falls back to the latest entered, then the id, so the order is stable. */
export function sortRecordsNewestFirst<T extends { id: string; completedOn: string; createdAt?: string }>(records: readonly T[]): T[] {
  return [...records].sort((a, b) =>
    b.completedOn.localeCompare(a.completedOn)
    || (b.createdAt ?? "").localeCompare(a.createdAt ?? "")
    || a.id.localeCompare(b.id));
}

export function recordLabel(record: { kind: string; certificationKey: string | null; workshopCode: string | null; workshopTitle: string | null }): string {
  if (record.kind === "CERTIFICATION") return certificationLabel(record.certificationKey);
  return [record.workshopCode, record.workshopTitle].filter(Boolean).join(" ") || "Workshop";
}

/** The audit summary's description of a record: the kind and the certification. Text the club typed (a workshop code) stays in the metadata only. */
export function recordAuditName(record: { kind: string; certificationKey: string | null }): string {
  return record.kind === "CERTIFICATION" ? `certification ${certificationLabel(record.certificationKey)}` : "workshop";
}
