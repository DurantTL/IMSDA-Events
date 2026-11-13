import "server-only";

import { z } from "zod";
import { phoneToStore } from "@/lib/field-validation";
import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { auditCrossEventIdentityRead } from "@/modules/people/identity-read-audit";
import {
  historyEntriesFor,
  staffPersonalValueFields,
  type StaffPersonalValueField,
} from "@/modules/attendee-accounts/profile-conflicts";

/**
 * System administrator correction of an attendee account's mailing address and emergency contact (#1512, slice 2). The
 * caller has already passed the system administrator gate (`requireSystemAdministrator`); nothing here decides who may call.
 *
 * The current values are never part of a list or page load: they are fetched for one account at a time, on request, and
 * each fetch is written to the cross-event identity read audit before the values are returned. A correction needs a
 * reason and the statement that the person asked for it; both go to the audit log, the values never do. The change
 * history keeps old and new values for these fields on a STAFF_CORRECTION row only (database check, migration
 * 20270178100000).
 */

export type StaffPersonalValues = Record<StaffPersonalValueField, string>;

/** The same limits the profile form enforces (profile-service.ts). */
const maxLength: Record<StaffPersonalValueField, number> = {
  mailingLine1: 200,
  mailingLine2: 200,
  mailingCity: 200,
  mailingRegion: 200,
  mailingPostalCode: 200,
  mailingCountry: 200,
  emergencyContactName: 120,
  emergencyContactRelationship: 80,
  emergencyContactPhone: 40,
};

const personalColumns = Object.fromEntries(staffPersonalValueFields.map((field) => [field, true])) as Record<StaffPersonalValueField, true>;

const valueShape = Object.fromEntries(
  staffPersonalValueFields.map((field) => [field, z.string().trim().max(maxLength[field])]),
) as Record<StaffPersonalValueField, z.ZodString>;

export const staffPersonalCorrectionSchema = z.strictObject({
  accountId: z.string().trim().min(1).max(100),
  reason: z.string().trim().min(5, "Give a reason of at least five characters.").max(500),
  /** Must be literally true: the person asked for this change. */
  personRequested: z.literal(true, { error: "Confirm that the person asked for this change." }),
  /** The values the administrator was looking at; a correction against anything else is refused as stale. */
  expected: z.strictObject(valueShape),
  corrected: z.strictObject(valueShape),
});

export type StaffPersonalCorrectionInput = z.infer<typeof staffPersonalCorrectionSchema>;

export class StaffPersonalCorrectionError extends Error {
  constructor(readonly code: "NOT_FOUND" | "STALE" | "NO_CHANGE", message: string) {
    super(message);
    this.name = "StaffPersonalCorrectionError";
  }
}

function toValues(row: Record<StaffPersonalValueField, string | null>): StaffPersonalValues {
  return Object.fromEntries(staffPersonalValueFields.map((field) => [field, row[field] ?? ""])) as StaffPersonalValues;
}

/** One account's current address and emergency contact, audited before it is returned. */
export async function getPersonalValuesForStaff(actorUserId: string, accountId: string) {
  const row = await getPrisma().attendeeAccount.findUnique({
    where: { id: accountId },
    select: { ...personalColumns, displayName: true },
  });
  if (!row) throw new StaffPersonalCorrectionError("NOT_FOUND", "That account was not found.");
  await auditCrossEventIdentityRead({
    actorUserId,
    surface: "ATTENDEE_PROFILE_PERSONAL",
    entityId: accountId,
    resultIds: [accountId],
  });
  return { accountId, accountName: row.displayName, values: toValues(row) };
}

export async function applyStaffPersonalCorrection(actorUserId: string, input: StaffPersonalCorrectionInput) {
  return getPrisma().$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "AttendeeAccount" WHERE "id" = ${input.accountId} FOR UPDATE`;
    if (locked.length === 0) throw new StaffPersonalCorrectionError("NOT_FOUND", "That account was not found.");
    const row = await tx.attendeeAccount.findUniqueOrThrow({
      where: { id: input.accountId },
      select: personalColumns,
    });
    const current = toValues(row);
    if (staffPersonalValueFields.some((field) => current[field].trim() !== input.expected[field])) {
      throw new StaffPersonalCorrectionError("STALE", "This profile changed since you opened it. Open the correction again.");
    }
    const next: StaffPersonalValues = {
      ...input.corrected,
      // Phones go through the shared check; the stored one is read here, never taken from the request.
      emergencyContactPhone: phoneToStore(["corrected", "emergencyContactPhone"], input.corrected.emergencyContactPhone, current.emergencyContactPhone),
    };
    const changed = staffPersonalValueFields.filter((field) => current[field] !== next[field]);
    if (changed.length === 0) throw new StaffPersonalCorrectionError("NO_CHANGE", "Nothing was changed.");
    await tx.attendeeAccount.update({
      where: { id: input.accountId },
      data: Object.fromEntries(changed.map((field) => [field, next[field] || null])),
      select: { id: true },
    });
    await tx.attendeeProfileChange.createMany({
      data: historyEntriesFor(
        changed.map((field) => ({ field, oldValue: current[field], newValue: next[field] })),
        "STAFF_CORRECTION",
      ).map((entry) => ({
        accountId: input.accountId,
        ...entry,
        source: "STAFF_CORRECTION" as const,
        actorUserId,
        reason: input.reason,
      })),
    });
    // The reason and the confirmation are recorded; the values never are.
    await writeAuditLog({
      actorUserId,
      action: "ATTENDEE_PERSONAL_PROFILE_CORRECTED_BY_STAFF",
      entityType: "AttendeeAccount",
      entityId: input.accountId,
      summary: "A system administrator corrected an attendee's address or emergency contact.",
      metadata: { changedFields: changed, reason: input.reason, personRequested: true },
    }, tx);
    return { changedFields: changed };
  });
}
