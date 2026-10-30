import "server-only";

import { randomUUID } from "node:crypto";
import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";

/**
 * Anonymization, not erasure (#127): an approved deletion request replaces a
 * person's personal fields and keeps the person row, so financial records,
 * consent and acknowledgment evidence, registrations and audit history stay
 * attached to the (now anonymous) person.
 *
 * This is deliberately a separate file and is not imported by the merge
 * module, and nothing in a merge function or route calls it. There is no
 * route or screen for it yet; it is a service function for an approved,
 * human-run request. The field list below is the single declared place that
 * says what counts as personal on `Person` (the ADR's list can change it here).
 */
export const PERSON_ANONYMIZED_FIELDS = ["firstName", "lastName", "normalizedEmail", "phone"] as const;

export type PersonAnonymizedField = (typeof PERSON_ANONYMIZED_FIELDS)[number];

export const PERSON_ANONYMIZED_REPLACEMENTS = {
  firstName: "Anonymized",
  lastName: "Person",
  normalizedEmail: null,
  phone: null,
} as const satisfies Record<PersonAnonymizedField, string | null>;

export const ANONYMIZATION_REFERENCE_MIN_LENGTH = 5;

export class PersonAnonymizationError extends Error {
  constructor(
    public readonly code: "NOT_FOUND" | "INVALID_REFERENCE" | "APPROVER_NOT_ALLOWED",
    message: string,
  ) {
    super(message);
    this.name = "PersonAnonymizationError";
  }
}

export type AnonymizePersonInput = {
  personId: string;
  /** The system administrator who approved the deletion request. */
  approvedByUserId: string;
  /** Where the approval is recorded (a request number or short note). Stored, never put in the audit log. */
  approvalReference: string;
};

/**
 * Anonymizes the declared personal fields of one person. Idempotent: a person
 * already anonymized is returned unchanged with `alreadyAnonymized: true` and
 * writes nothing. Touches only the `Person` row, plus the anonymization record
 * and one audit entry; it never reads or changes payments, the ledger,
 * consent or acknowledgment evidence, registrations or audit rows.
 */
export async function anonymizePerson(input: AnonymizePersonInput) {
  const approvalReference = input.approvalReference.trim();
  if (approvalReference.length < ANONYMIZATION_REFERENCE_MIN_LENGTH) {
    throw new PersonAnonymizationError("INVALID_REFERENCE", "An approval reference of at least five characters is required.");
  }

  return getPrisma().$transaction(async (tx) => {
    // The same lock merge and unmerge take (kept as a literal so this file stays free of merge imports), so an
    // anonymization cannot commit between a merge's anonymized check and the merge's own commit.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('person-merge', 0))`;
    const approver = await tx.user.findUnique({ where: { id: input.approvedByUserId }, select: { globalRole: true } });
    if (approver?.globalRole !== "SYSTEM_ADMIN") {
      throw new PersonAnonymizationError("APPROVER_NOT_ALLOWED", "Only a system administrator can approve an anonymization.");
    }
    const person = await tx.person.findUnique({ where: { id: input.personId }, select: { id: true, anonymizedAt: true } });
    if (!person) throw new PersonAnonymizationError("NOT_FOUND", "That person was not found.");
    if (person.anonymizedAt) return { personId: person.id, alreadyAnonymized: true as const };

    const anonymizedAt = new Date();
    // The guard on anonymizedAt makes two racing requests write once.
    const changed = await tx.person.updateMany({
      where: { id: person.id, anonymizedAt: null },
      data: { ...PERSON_ANONYMIZED_REPLACEMENTS, anonymizedAt },
    });
    if (changed.count === 0) return { personId: person.id, alreadyAnonymized: true as const };

    // An anonymous person is not a duplicate to review: close any open candidate that involves them.
    await tx.personMatchCandidate.updateMany({
      where: { state: "OPEN", OR: [{ personAId: person.id }, { personBId: person.id }] },
      data: { state: "SUPERSEDED" },
    });
    await tx.personAnonymization.create({
      data: {
        personId: person.id,
        approvedByUserId: input.approvedByUserId,
        approvalReference,
        fields: [...PERSON_ANONYMIZED_FIELDS],
        anonymizedAt,
      },
    });
    await writeAuditLog({
      actorUserId: input.approvedByUserId,
      action: "PERSON_ANONYMIZED",
      entityType: "Person",
      entityId: person.id,
      correlationId: randomUUID(),
      summary: `Anonymized person ${person.id}.`,
      metadata: { personId: person.id, fields: [...PERSON_ANONYMIZED_FIELDS] },
    }, tx);
    return { personId: person.id, alreadyAnonymized: false as const };
  });
}
