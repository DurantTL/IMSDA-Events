import "server-only";

import { Prisma } from "@prisma/client";
import { z } from "zod";
import { phoneToStore } from "@/lib/field-validation";
import { formatPersonName } from "@/lib/person-name";
import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import {
  accountHolderAttendeeIndex,
  historyEntriesFor,
  profileConflicts,
  profileReviewVersion,
  reviewableFields,
  type ProfileConflict,
  type ReviewableField,
  type ReviewableProfile,
} from "@/modules/attendee-accounts/profile-conflicts";
import { todayDateValue } from "@/modules/forms/definition";
import { authorizeAttendeeRegistration } from "@/modules/attendee-accounts/registrations-repository";

/**
 * Review of the saved profile against one registration's answers (#1512). The person is shown where the two differ
 * and may choose which saved values to replace; nothing changes without that choice.
 *
 * The new values always come from the registration answers stored on the server, never from the request. The request
 * names fields and carries the version it was shown; a version that no longer matches is refused as stale.
 */

type ReviewAccount = { id: string; verifiedEmail: string };

export type ProfileReviewErrorCode = "NOT_FOUND" | "STALE";

export class ProfileReviewError extends Error {
  constructor(readonly code: ProfileReviewErrorCode, message: string) {
    super(message);
    this.name = "ProfileReviewError";
  }
}

export const applyReviewSchema = z.strictObject({
  registrationId: z.string().trim().min(1).max(100),
  fields: z.array(z.enum(reviewableFields)).min(1, "Choose at least one field to update.").max(reviewableFields.length),
  version: z.string().regex(/^[0-9a-f]{64}$/, "Review your profile again and try once more."),
});

// The same limits the profile form enforces (profile-service.ts), so a review cannot store what a form edit could not.
const maxLength: Record<ReviewableField, number> = {
  firstName: 80,
  lastName: 80,
  phone: 40,
  shirtSize: 80,
  mailingLine1: 200,
  mailingLine2: 200,
  mailingCity: 200,
  mailingRegion: 200,
  mailingPostalCode: 200,
  mailingCountry: 200,
  emergencyContactName: 120,
  emergencyContactPhone: 40,
};

const profileColumns = Object.fromEntries(reviewableFields.map((field) => [field, true])) as Record<ReviewableField, true>;

type AnswerClient = Pick<Prisma.TransactionClient, "registration">;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Keys of the fields with the given scope in a stored form definition. An unreadable definition yields none. */
function scopeKeys(definition: unknown, wanted: "REGISTRATION" | "ATTENDEE"): Set<string> {
  const keys = new Set<string>();
  const sections = record(definition).sections;
  if (!Array.isArray(sections)) return keys;
  for (const section of sections) {
    const fields = record(section).fields;
    if (!Array.isArray(fields)) continue;
    for (const field of fields) {
      const { key, scope } = record(field);
      if (scope === wanted && typeof key === "string") keys.add(key);
    }
  }
  return keys;
}

export type ReviewAnswers = {
  /** The registration-scope answers. */
  registration: Record<string, unknown>;
  /** The account holder's attendee-scope answers: empty unless exactly one adult attendee is provably the holder. */
  holder: Record<string, unknown>;
};

/**
 * The registration's current answers: the latest amendment's snapshot, else the original submission's, for the
 * registration scope; and, only when exactly one adult attendee is the signed-in account holder, that attendee's
 * attendee-scope answers.
 *
 * Attendee answers are read from the attendees now on the registration (`RegistrationAttendee.formResponses` in
 * roster order), which is where an amendment writes them, so an attendee who was removed is not considered. Only keys
 * the stored form version defines at attendee scope are kept. Any other attendee's answers are never returned.
 */
async function currentAnswers(client: AnswerClient, registrationId: string, verifiedEmail: string): Promise<ReviewAnswers | null> {
  const registration = await client.registration.findUnique({
    where: { id: registrationId },
    select: {
      publicFormSubmission: { select: { responses: true, formVersion: { select: { definition: true } } } },
      operations: {
        where: { type: "AMENDMENT" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { afterSnapshot: true },
      },
      attendees: { orderBy: [{ position: "asc" }, { id: "asc" }], select: { formResponses: true } },
    },
  });
  const submission = registration?.publicFormSubmission;
  if (!submission) return null;
  const amended = record(record(registration.operations[0]?.afterSnapshot).registrationResponses);
  const answers = Object.keys(amended).length > 0 ? amended : record(submission.responses);
  const definition = submission.formVersion.definition;
  const registrationKeys = scopeKeys(definition, "REGISTRATION");
  const attendeeKeys = scopeKeys(definition, "ATTENDEE");
  const keep = (source: Record<string, unknown>, allowed: Set<string>) =>
    Object.fromEntries(Object.entries(source).filter(([key]) => allowed.has(key)));
  const registrationAnswers = keep(answers, registrationKeys);
  const attendeeAnswers = registration.attendees.map((attendee) => keep(record(attendee.formResponses), attendeeKeys));
  const holderIndex = accountHolderAttendeeIndex({ verifiedEmail, registrationAnswers, attendeeAnswers, today: todayDateValue() });
  return { registration: registrationAnswers, holder: holderIndex === null ? {} : attendeeAnswers[holderIndex]! };
}

type StoredProfileRow = Record<ReviewableField, string | null> & { displayName: string };

function reviewableProfile(row: StoredProfileRow): ReviewableProfile {
  // A name never saved separately falls back to the display name, as the profile form shows it.
  const parts = row.displayName.trim().split(/\s+/);
  const fallbackFirst = parts.shift() ?? "";
  const fallbackLast = parts.join(" ");
  return Object.fromEntries(
    reviewableFields.map((field) => [field, row[field] ?? (field === "firstName" ? fallbackFirst : field === "lastName" ? fallbackLast : "")]),
  ) as ReviewableProfile;
}

function offeredConflicts(profile: ReviewableProfile, answers: ReviewAnswers, includePersonal: boolean) {
  return profileConflicts(profile, answers.registration, includePersonal, answers.holder)
    .filter((conflict) => conflict.enteredValue.length <= maxLength[conflict.field]);
}

export type RegistrationProfileReview = {
  registrationId: string;
  version: string;
  conflicts: ProfileConflict[];
};

export async function getRegistrationProfileReview(
  account: ReviewAccount,
  registrationId: string,
  options: { includePersonal?: boolean } = {},
): Promise<RegistrationProfileReview | null> {
  const includePersonal = options.includePersonal ?? true;
  const owned = await authorizeAttendeeRegistration(account.verifiedEmail, registrationId);
  if (!owned) return null;
  const prisma = getPrisma();
  const answers = await currentAnswers(prisma, owned.registrationId, account.verifiedEmail);
  if (!answers) return { registrationId: owned.registrationId, version: "", conflicts: [] };
  const row = await prisma.attendeeAccount.findUniqueOrThrow({
    where: { id: account.id },
    select: { ...profileColumns, displayName: true },
  });
  const profile = reviewableProfile(row);
  return {
    registrationId: owned.registrationId,
    version: profileReviewVersion(profile, answers.registration, includePersonal, answers.holder),
    conflicts: offeredConflicts(profile, answers, includePersonal),
  };
}

export async function applyRegistrationProfileReview(
  account: ReviewAccount,
  input: { registrationId: string; fields: readonly ReviewableField[]; version: string },
  options: { includePersonal?: boolean } = {},
) {
  const includePersonal = options.includePersonal ?? true;
  const owned = await authorizeAttendeeRegistration(account.verifiedEmail, input.registrationId);
  if (!owned) throw new ProfileReviewError("NOT_FOUND", "That registration was not found.");
  return getPrisma().$transaction(async (tx) => {
    // The profile row is locked before it is read, so the version below is judged against what is really stored.
    await tx.$queryRaw`SELECT "id" FROM "AttendeeAccount" WHERE "id" = ${account.id} FOR UPDATE`;
    const answers = await currentAnswers(tx, owned.registrationId, account.verifiedEmail);
    const row = await tx.attendeeAccount.findUniqueOrThrow({
      where: { id: account.id },
      select: { ...profileColumns, displayName: true },
    });
    const before = reviewableProfile(row);
    const stale = () => new ProfileReviewError(
      "STALE",
      "Your profile or this registration changed since you looked. Review the differences again.",
    );
    if (!answers) throw stale();
    if (profileReviewVersion(before, answers.registration, includePersonal, answers.holder) !== input.version) throw stale();

    const selected = new Set(input.fields);
    const chosen = offeredConflicts(before, answers, includePersonal).filter((conflict) => selected.has(conflict.field));
    if (chosen.length === 0) return { applied: [] as ReviewableField[] };

    const data: Partial<Record<ReviewableField, string>> = {};
    for (const conflict of chosen) {
      // Phones go through the shared check, as a profile edit does; the stored one is read here, never from the request.
      data[conflict.field] = conflict.field === "phone" || conflict.field === "emergencyContactPhone"
        ? phoneToStore([conflict.field], conflict.enteredValue, before[conflict.field])
        : conflict.enteredValue;
    }
    const merged = { ...before, ...data };
    const changed = chosen.filter((conflict) => before[conflict.field] !== merged[conflict.field]);
    const nameChanged = chosen.some((conflict) => conflict.field === "firstName" || conflict.field === "lastName");
    await tx.attendeeAccount.update({
      where: { id: account.id },
      data: {
        ...data,
        ...(nameChanged ? { displayName: formatPersonName(merged) || undefined } : {}),
      },
      select: { id: true },
    });
    if (changed.length > 0) {
      await tx.attendeeProfileChange.createMany({
        data: historyEntriesFor(
          changed.map((conflict) => ({
            field: conflict.field,
            oldValue: before[conflict.field],
            newValue: merged[conflict.field],
          })),
          "REGISTRATION_REVIEW",
        ).map((entry) => ({
          accountId: account.id,
          ...entry,
          source: "REGISTRATION_REVIEW" as const,
          registrationId: owned.registrationId,
          actorAttendeeAccountId: account.id,
        })),
      });
    }
    const applied = chosen.map((conflict) => conflict.field);
    // Field names only: no value from the profile or the registration reaches the audit log.
    await writeAuditLog({
      eventId: owned.eventId,
      action: "ATTENDEE_PROFILE_REVIEWED_FROM_REGISTRATION",
      entityType: "AttendeeAccount",
      entityId: account.id,
      summary: "An attendee updated their saved profile from a registration.",
      metadata: { actorAttendeeAccountId: account.id, registrationId: owned.registrationId, changedFields: applied },
    }, tx);
    return { applied };
  });
}
