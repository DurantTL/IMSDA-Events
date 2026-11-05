/**
 * The one list of every database column that holds a value sealed with
 * `lib/secret-box.ts` (#1516). Key rotation (`npm run key:rotate`) and the key
 * health check (`npm run key:check`) walk exactly this list, so a column that is
 * missing here would silently keep the old key after a rotation. A guard test
 * (`tests/sealed-columns-registry.test.ts`) scans the source for sealing call
 * sites and the Prisma schema for `sealed*` columns and fails when one is not
 * represented here.
 *
 * Pure data: no database access and no `server-only` import, so tests and the
 * operator scripts can load it.
 */

/** The Prisma delegate names (camelCase model names) that hold a sealed column. */
export type SealedModel =
  | "userMfaEnrollment"
  | "attendeeMfaEnrollment"
  | "attendeeAccountToken"
  | "attendeeStepUpCode"
  | "securityCheckCode"
  | "clubRosterMember"
  | "backgroundCheckEntry"
  | "clubFormSubmission"
  | "calendarFeed"
  | "healthRecordField"
  | "healthRecordSnapshotField";

export type SealedRowFields = Record<string, unknown>;

export type SealedColumn = {
  /** `Model.column`, what the commands print. Never a value. */
  label: string;
  model: SealedModel;
  /** The Prisma model name as the schema spells it (used by the schema guard test). */
  schemaModel: string;
  column: string;
  /** Required columns cannot be filtered with `not: null`. */
  nullable: boolean;
  /** Other columns of the row that the purpose is built from. */
  purposeColumns: readonly string[];
  /**
   * Columns Prisma maintains on every update (`@updatedAt`). Rotation writes the
   * row's own value back so re-sealing does not change "last modified".
   */
  preserve: readonly string[];
  /** The key purpose the row's value was sealed under, exactly as the owning module spells it. */
  purpose: (row: SealedRowFields) => string;
  /**
   * A keyed fingerprint stored next to the sealed value. Rotation recomputes it
   * from the opened value in the same update as the re-sealed value.
   */
  fingerprint?: {
    column: string;
    purpose: string;
    /** Other rows that carry a copy of the old fingerprint, moved to the new one in the same transaction. */
    copies?: { model: "calendarEntry"; column: string }[];
  };
  /** Source files (repo-relative) that seal or fingerprint a value for this column. */
  sourceFiles: readonly string[];
};

function text(row: SealedRowFields, column: string) {
  const value = row[column];
  if (typeof value !== "string") throw new Error(`Missing column ${column}`);
  return value;
}

const STEP_UP_PURPOSES: Record<string, string> = {
  // Mirrors modules/attendee-accounts/{sign-in-code-service,two-step-recovery,step-up-service}.ts.
  SIGN_IN: "attendee-sign-in-code",
  TWO_STEP_RECOVERY: "attendee-two-step-recovery",
};

export const SEALED_COLUMNS: readonly SealedColumn[] = [
  {
    label: "UserMfaEnrollment.sealedSecret",
    model: "userMfaEnrollment",
    schemaModel: "UserMfaEnrollment",
    preserve: ["updatedAt"],
    column: "sealedSecret",
    nullable: false,
    purposeColumns: [],
    purpose: () => "mfa-totp-secret",
    sourceFiles: ["modules/access/mfa-service.ts"],
  },
  {
    label: "AttendeeMfaEnrollment.sealedSecret",
    model: "attendeeMfaEnrollment",
    schemaModel: "AttendeeMfaEnrollment",
    preserve: ["updatedAt"],
    column: "sealedSecret",
    nullable: false,
    purposeColumns: [],
    purpose: () => "attendee-mfa-totp-secret",
    sourceFiles: ["modules/attendee-accounts/mfa-service.ts"],
  },
  {
    label: "AttendeeAccountToken.sealedCode",
    model: "attendeeAccountToken",
    schemaModel: "AttendeeAccountToken",
    preserve: [],
    column: "sealedCode",
    nullable: true,
    purposeColumns: [],
    purpose: () => "attendee-email-code",
    sourceFiles: ["modules/attendee-accounts/account-service.ts"],
  },
  {
    // One column, three key purposes, told apart by the row's own `purpose`.
    label: "AttendeeStepUpCode.sealedCode",
    model: "attendeeStepUpCode",
    schemaModel: "AttendeeStepUpCode",
    preserve: [],
    column: "sealedCode",
    nullable: true,
    purposeColumns: ["purpose"],
    purpose: (row) => STEP_UP_PURPOSES[text(row, "purpose")] ?? "attendee-step-up-code",
    sourceFiles: [
      "modules/attendee-accounts/step-up-service.ts",
      "modules/attendee-accounts/sign-in-code-service.ts",
      "modules/attendee-accounts/two-step-recovery.ts",
    ],
  },
  {
    label: "SecurityCheckCode.sealedCode",
    model: "securityCheckCode",
    schemaModel: "SecurityCheckCode",
    preserve: [],
    column: "sealedCode",
    nullable: true,
    purposeColumns: [],
    purpose: () => "security-check-code",
    sourceFiles: ["modules/security/security-check-code-store.ts"],
  },
  {
    label: "ClubRosterMember.sealedBirthDate",
    model: "clubRosterMember",
    schemaModel: "ClubRosterMember",
    preserve: ["updatedAt"],
    column: "sealedBirthDate",
    nullable: true,
    purposeColumns: [],
    purpose: () => "club-roster:birth-date",
    sourceFiles: ["modules/club-rosters/birth-dates.ts"],
  },
  {
    // The Sterling Volunteers list entries: birth dates are sealed with the same helper as roster birth dates.
    label: "BackgroundCheckEntry.sealedBirthDate",
    model: "backgroundCheckEntry",
    schemaModel: "BackgroundCheckEntry",
    preserve: ["updatedAt"],
    column: "sealedBirthDate",
    nullable: true,
    purposeColumns: [],
    purpose: () => "club-roster:birth-date",
    sourceFiles: ["modules/club-rosters/birth-dates.ts"],
  },
  {
    label: "ClubFormSubmission.sealedSensitiveAnswers",
    model: "clubFormSubmission",
    schemaModel: "ClubFormSubmission",
    preserve: ["updatedAt"],
    column: "sealedSensitiveAnswers",
    nullable: true,
    purposeColumns: [],
    purpose: (row) => `club-form:sensitive-answers:${text(row, "id")}`,
    sourceFiles: ["modules/club-forms/sealed-answers.ts"],
  },
  {
    label: "CalendarFeed.sealedUrl",
    model: "calendarFeed",
    schemaModel: "CalendarFeed",
    preserve: ["updatedAt"],
    column: "sealedUrl",
    nullable: false,
    purposeColumns: [],
    purpose: () => "calendar-feed-url",
    fingerprint: {
      column: "urlFingerprint",
      purpose: "calendar-feed-url",
      copies: [{ model: "calendarEntry", column: "sourceUrlFingerprint" }],
    },
    sourceFiles: ["modules/calendar/feeds.ts"],
  },
  {
    label: "HealthRecordField.sealedValue",
    model: "healthRecordField",
    schemaModel: "HealthRecordField",
    preserve: ["updatedAt"],
    column: "sealedValue",
    nullable: false,
    purposeColumns: ["recordId", "fieldKey"],
    purpose: (row) => `health-record:${text(row, "recordId")}:${text(row, "fieldKey")}`,
    sourceFiles: ["modules/health-records/crypto.ts"],
  },
  {
    label: "HealthRecordSnapshotField.sealedValue",
    model: "healthRecordSnapshotField",
    schemaModel: "HealthRecordSnapshotField",
    preserve: [],
    column: "sealedValue",
    nullable: false,
    purposeColumns: ["snapshotId", "fieldKey"],
    purpose: (row) => `health-snapshot:${text(row, "snapshotId")}:${text(row, "fieldKey")}`,
    sourceFiles: ["modules/health-records/crypto.ts"],
  },
];

/** Source files that seal or fingerprint through the registry's own machinery rather than owning a column. */
export const SEALING_INFRASTRUCTURE_FILES: readonly string[] = [
  "lib/secret-box.ts",
  "modules/security/key-rotation.ts",
];
