import "server-only";

import { z } from "zod";
import { phoneToStore } from "@/lib/field-validation";
import { formatPersonName } from "@/lib/person-name";
import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { auditCrossEventIdentityRead } from "@/modules/people/identity-read-audit";
import {
  historyEntriesFor,
  isStaffPersonalValueField,
  isValueKeptField,
  profileFieldLabel,
  staffPersonalValueFields,
  valueKeptFields,
  type ValueKeptField,
} from "@/modules/attendee-accounts/profile-conflicts";

/**
 * Staff view and correction of attendee profile changes (#1512). The caller has already passed the system
 * administrator gate (`requireSystemAdministrator`); these functions never decide who may call them.
 *
 * Staff see name, phone and shirt size values. They also see the old and new values of a STAFF_CORRECTION row for the
 * mailing address and emergency contact (a system administrator's own correction, `profile-personal-staff.ts`).
 * Address and emergency contact changes made by the attendee are never listed. Dietary and accessibility needs are
 * not part of this feature at all.
 */

export const PROFILE_CHANGE_LIST_LIMIT = 100;

const sourceLabels = {
  SELF_EDIT: "Edited by the attendee",
  REGISTRATION_REVIEW: "Updated from a registration",
  STAFF_CORRECTION: "Staff correction",
} as const;

export type StaffProfileChange = {
  id: string;
  createdAt: string;
  accountId: string;
  accountName: string;
  fieldLabel: string;
  /** Present only for name, phone and shirt size, and for a staff correction of address or emergency contact. */
  oldValue: string | null;
  newValue: string | null;
  sourceLabel: string;
  confirmationCode: string | null;
  reason: string | null;
};

export type StaffCorrectableAccount = {
  accountId: string;
  accountName: string;
  current: Record<ValueKeptField, string>;
};

/** The page number a `?page=` value asks for: a whole number from 1, anything else is the first page. */
export function parseProfileChangePage(value: unknown): number {
  const text = Array.isArray(value) ? value[0] : value;
  const page = typeof text === "string" && /^\d{1,6}$/.test(text) ? Number(text) : 1;
  return page >= 1 ? page : 1;
}

export async function listProfileChangesForStaff(actorUserId: string, requestedPage = 1) {
  const page = Math.max(1, Math.floor(requestedPage));
  // Attendee-made address and emergency contact changes are never listed: only the value-kept fields, and a staff
  // correction of the personal fields, are read.
  const fetched = await getPrisma().attendeeProfileChange.findMany({
    where: {
      OR: [
        { field: { in: [...valueKeptFields] } },
        { source: "STAFF_CORRECTION", field: { in: [...staffPersonalValueFields] } },
      ],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * PROFILE_CHANGE_LIST_LIMIT,
    // One more than a page, to know whether older changes exist.
    take: PROFILE_CHANGE_LIST_LIMIT + 1,
    select: {
      id: true,
      createdAt: true,
      accountId: true,
      field: true,
      oldValue: true,
      newValue: true,
      source: true,
      reason: true,
      registration: { select: { confirmationCode: true } },
      account: { select: { displayName: true, firstName: true, lastName: true, phone: true, shirtSize: true } },
    },
  });
  const hasOlder = fetched.length > PROFILE_CHANGE_LIST_LIMIT;
  const rows = fetched.slice(0, PROFILE_CHANGE_LIST_LIMIT);
  // Written before the data is handed back, like the other cross-event identity reads.
  await auditCrossEventIdentityRead({
    actorUserId,
    surface: "ATTENDEE_PROFILE_CHANGES",
    resultIds: rows.map((row) => row.id),
    extra: { page },
  });
  const changes: StaffProfileChange[] = rows.map((row) => {
    // Belt and braces: a value never leaves for any other field, or for a personal field from another source.
    const keep = isValueKeptField(row.field) || (row.source === "STAFF_CORRECTION" && isStaffPersonalValueField(row.field));
    return {
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      accountId: row.accountId,
      accountName: row.account.displayName,
      fieldLabel: profileFieldLabel(row.field),
      oldValue: keep ? row.oldValue : null,
      newValue: keep ? row.newValue : null,
      sourceLabel: sourceLabels[row.source],
      confirmationCode: row.registration?.confirmationCode ?? null,
      reason: row.reason,
    };
  });
  const accounts = new Map<string, StaffCorrectableAccount>();
  for (const row of rows) {
    if (accounts.has(row.accountId)) continue;
    accounts.set(row.accountId, {
      accountId: row.accountId,
      accountName: row.account.displayName,
      current: {
        firstName: row.account.firstName ?? "",
        lastName: row.account.lastName ?? "",
        phone: row.account.phone ?? "",
        shirtSize: row.account.shirtSize ?? "",
      },
    });
  }
  return { changes, accounts: [...accounts.values()], page, hasOlder, hasNewer: page > 1 };
}

const text = (maximum: number) => z.string().trim().max(maximum);
const valueShape = {
  firstName: text(80),
  lastName: text(80),
  phone: text(40),
  shirtSize: text(80),
};

export const staffCorrectionSchema = z.strictObject({
  accountId: z.string().trim().min(1).max(100),
  reason: z.string().trim().min(5, "Give a reason of at least five characters.").max(500),
  /** The values the staff member was looking at; a correction against anything else is refused as stale. */
  expected: z.strictObject(valueShape),
  corrected: z.strictObject(valueShape),
});

export type StaffCorrectionInput = z.infer<typeof staffCorrectionSchema>;

export class StaffCorrectionError extends Error {
  constructor(readonly code: "NOT_FOUND" | "STALE" | "NO_CHANGE", message: string) {
    super(message);
    this.name = "StaffCorrectionError";
  }
}

export async function applyStaffProfileCorrection(actorUserId: string, input: StaffCorrectionInput) {
  return getPrisma().$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "AttendeeAccount" WHERE "id" = ${input.accountId} FOR UPDATE`;
    if (locked.length === 0) throw new StaffCorrectionError("NOT_FOUND", "That account was not found.");
    const row = await tx.attendeeAccount.findUniqueOrThrow({
      where: { id: input.accountId },
      select: { firstName: true, lastName: true, phone: true, shirtSize: true },
    });
    const current: Record<ValueKeptField, string> = {
      firstName: row.firstName ?? "",
      lastName: row.lastName ?? "",
      phone: row.phone ?? "",
      shirtSize: row.shirtSize ?? "",
    };
    if (valueKeptFields.some((field) => current[field].trim() !== input.expected[field])) {
      throw new StaffCorrectionError("STALE", "This profile changed since you opened it. Reload the page and correct it again.");
    }
    const next: Record<ValueKeptField, string> = {
      ...input.corrected,
      // A phone goes through the shared check; the stored one is read here, never taken from the request.
      phone: phoneToStore(["corrected", "phone"], input.corrected.phone, current.phone),
    };
    const changed = valueKeptFields.filter((field) => current[field] !== next[field]);
    if (changed.length === 0) throw new StaffCorrectionError("NO_CHANGE", "Nothing was changed.");
    const nameChanged = changed.includes("firstName") || changed.includes("lastName");
    await tx.attendeeAccount.update({
      where: { id: input.accountId },
      data: {
        firstName: next.firstName || null,
        lastName: next.lastName || null,
        phone: next.phone || null,
        shirtSize: next.shirtSize || null,
        ...(nameChanged ? { displayName: formatPersonName(next) || undefined } : {}),
      },
      select: { id: true },
    });
    await tx.attendeeProfileChange.createMany({
      data: historyEntriesFor(changed.map((field) => ({ field, oldValue: current[field], newValue: next[field] }))).map((entry) => ({
        accountId: input.accountId,
        ...entry,
        source: "STAFF_CORRECTION" as const,
        actorUserId,
        reason: input.reason,
      })),
    });
    // Field names only: neither the values nor the reason text go into the audit log.
    await writeAuditLog({
      actorUserId,
      action: "ATTENDEE_PROFILE_CORRECTED_BY_STAFF",
      entityType: "AttendeeAccount",
      entityId: input.accountId,
      summary: "Staff corrected an attendee's saved profile.",
      metadata: { changedFields: changed },
    }, tx);
    return { changedFields: changed };
  });
}
