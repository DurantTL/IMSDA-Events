import "server-only";

import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import {
  HEALTH_PRIVACY_ACK_VERSION,
  acknowledgmentSubjectFor,
  type AcknowledgmentSubject,
  type AcknowledgmentViewer,
} from "@/modules/health-records/acknowledgment-domain";
import { HealthRecordError } from "@/modules/health-records/errors";
import { requireHealthRecordsEnabled } from "@/modules/health-records/flag";

/**
 * Storage and checks for the one-time privacy acknowledgment (#923). The row
 * holds a person, a wording version and a time: no health data. The audit row
 * names the viewer kind and the version, nothing else.
 */

export const HEALTH_ACKNOWLEDGMENT_REQUIRED_MESSAGE = "Read and confirm the health information privacy notice before you continue.";

function whereFor(subject: AcknowledgmentSubject) {
  return "userId" in subject
    ? { userId: subject.userId, version: HEALTH_PRIVACY_ACK_VERSION }
    : { attendeeAccountId: subject.attendeeAccountId, version: HEALTH_PRIVACY_ACK_VERSION };
}

/** True when this person has acknowledged the current wording. */
export async function hasAcknowledgedHealthPrivacy(viewer: AcknowledgmentViewer): Promise<boolean> {
  const row = await getPrisma().healthPrivacyAcknowledgment.findFirst({ where: whereFor(acknowledgmentSubjectFor(viewer)), select: { id: true } });
  return row !== null;
}

/**
 * The gate every health entry point passes before it opens, enters or counts
 * anything: the person has acknowledged the current wording, or the request is
 * refused with a code the page and the API turn into the acknowledgment prompt.
 */
export async function requireHealthPrivacyAcknowledgment(viewer: AcknowledgmentViewer): Promise<void> {
  requireHealthRecordsEnabled();
  if (!(await hasAcknowledgedHealthPrivacy(viewer))) {
    throw new HealthRecordError("ACKNOWLEDGMENT_REQUIRED", HEALTH_ACKNOWLEDGMENT_REQUIRED_MESSAGE);
  }
}

/** Records the acknowledgment of the current wording. Idempotent: a second click changes nothing. */
export async function recordHealthPrivacyAcknowledgment(viewer: AcknowledgmentViewer, now = new Date()) {
  requireHealthRecordsEnabled();
  const subject = acknowledgmentSubjectFor(viewer);
  const prisma = getPrisma();
  const existing = await prisma.healthPrivacyAcknowledgment.findFirst({ where: whereFor(subject), select: { id: true } });
  if (existing) return { version: HEALTH_PRIVACY_ACK_VERSION, alreadyAcknowledged: true };
  try {
    await prisma.$transaction(async (tx) => {
      await tx.healthPrivacyAcknowledgment.create({ data: { ...whereFor(subject), acknowledgedAt: now } });
      await writeAuditLog({
        ...("userId" in subject ? { actorUserId: subject.userId } : {}),
        action: "HEALTH_PRIVACY_ACKNOWLEDGED",
        entityType: "HealthPrivacyAcknowledgment",
        entityId: "userId" in subject ? subject.userId : subject.attendeeAccountId,
        summary: "Acknowledged the health information privacy notice.",
        metadata: {
          viewerKind: viewer.kind,
          version: HEALTH_PRIVACY_ACK_VERSION,
          ...("attendeeAccountId" in subject ? { actorAttendeeAccountId: subject.attendeeAccountId } : {}),
        },
      }, tx);
    });
  } catch (error) {
    // Two clicks at once: the loser hits the unique key, and the person has acknowledged either way.
    if (!(typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002")) throw error;
  }
  return { version: HEALTH_PRIVACY_ACK_VERSION, alreadyAcknowledged: false };
}
