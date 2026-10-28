import "server-only";

import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { hashUserAgent } from "@/modules/access/tokens";
import type { RegistrationFormDefinition } from "@/modules/forms/definition";
import { planSignatures, presentSignatures, sha256, signatureEvidenceKey } from "@/modules/signatures/domain";

export type SubmissionSignatureInput = {
  eventId: string;
  registrationId: string;
  formVersionId: string;
  definition: RegistrationFormDefinition;
  registrationResponses: Record<string, unknown>;
  attendees: ReadonlyArray<{ clientId: string; attendeeId: string; responses: Record<string, unknown> }>;
  submissionKey: string;
  signedAt: Date;
  /** The trusted client IP; null or absent when it cannot be resolved. */
  ipAddress?: string | null;
  userAgent?: string | null;
};

/**
 * Records the typed-name signatures a committed-in-this-transaction registration gives (#1265): one append-only row per
 * visible, non-blank signature field (per attendee for attendee-level fields). A retried submission carries the same
 * submission key, so each row is written once.
 */
export async function recordSubmissionSignatures(tx: Prisma.TransactionClient, input: SubmissionSignatureInput) {
  const planned = planSignatures(input.definition, {
    registrationResponses: input.registrationResponses,
    attendees: input.attendees,
  });
  const userAgentHash = hashUserAgent(input.userAgent ?? null);
  const data: Prisma.SignatureEvidenceCreateManyInput[] = [];
  for (const item of planned) {
    const attendee = item.attendeeClientId === null ? null : input.attendees.find((candidate) => candidate.clientId === item.attendeeClientId) ?? null;
    if (item.attendeeClientId !== null && !attendee) continue;
    const signedText = item.field.signature?.text ?? "";
    data.push({
      eventId: input.eventId,
      registrationId: input.registrationId,
      registrationAttendeeId: attendee?.attendeeId ?? null,
      formVersionId: input.formVersionId,
      fieldId: item.field.id,
      fieldKey: item.field.key,
      fieldLabel: item.field.label,
      signerName: item.signerName,
      signedText,
      contentHash: sha256(signedText),
      signedAt: input.signedAt,
      ipAddress: input.ipAddress ?? null,
      userAgentHash,
      idempotencyKey: signatureEvidenceKey(input.registrationId, input.submissionKey, item.field.id, item.attendeeClientId),
    });
  }
  if (data.length === 0) return { planned: 0, recorded: 0 };
  const result = await tx.signatureEvidence.createMany({ data, skipDuplicates: true });
  return { planned: data.length, recorded: result.count };
}

/**
 * The signatures on one registration for staff (#1265). The signed text and IP address are read and returned only when
 * `canViewRecord` (VIEW_SENSITIVE_DATA, decided by the caller from the session); otherwise they never leave the database.
 * Null when the registration is not on this event.
 */
export async function listRegistrationSignatures(eventId: string, registrationId: string, canViewRecord: boolean) {
  const prisma = getPrisma();
  const registration = await prisma.registration.findFirst({ where: { id: registrationId, eventId }, select: { id: true } });
  if (!registration) return null;
  // Two explicit selects, so the signed text and IP column are never read for a caller without permission.
  const rows = canViewRecord
    ? await prisma.signatureEvidence.findMany({
      where: { eventId, registrationId },
      orderBy: [{ signedAt: "asc" }, { id: "asc" }],
      select: { id: true, fieldKey: true, fieldLabel: true, registrationAttendeeId: true, signerName: true, signedAt: true, signedText: true, contentHash: true, ipAddress: true },
    })
    : (await prisma.signatureEvidence.findMany({
      where: { eventId, registrationId },
      orderBy: [{ signedAt: "asc" }, { id: "asc" }],
      select: { id: true, fieldKey: true, fieldLabel: true, registrationAttendeeId: true, signerName: true, signedAt: true },
    })).map((row) => ({ ...row, signedText: "", contentHash: "", ipAddress: null }));
  return presentSignatures(rows, canViewRecord);
}
