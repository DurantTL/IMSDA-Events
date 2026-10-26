import "server-only";

import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { logError } from "@/lib/logger";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { HealthRecordError } from "@/modules/health-records/errors";

/**
 * The one break-glass mechanism (ADR 0005 Addendum B; #924 built it for sealed copies, #929 extends it to the live
 * record). A grant is one system administrator, one person, a typed reason and 24 hours
 * (`HealthSnapshotBreakGlass`). One grant covers that person's live Pathfinder Health Record and their sealed
 * per-event copies. It does not cover the coordinator / event health sheet, which reads registration and club form
 * data (owner decision 2026-10-14, ADR 0005 Addendum C). Every use writes a `HealthBreakGlassUse` row (for the
 * monthly review) and an audit row. Both hold ids, a kind and a time: never a health value.
 *
 * Act-as: a system administrator "acting as" a club director is still that administrator. The grant is theirs
 * (keyed by their user id, not the director's account), so acting as a director gives no access to health data
 * without break-glass, and the audit rows carry `actAsId` so the review shows it.
 */

export const BREAK_GLASS_REQUIRED_MESSAGE = "Reading this health information needs break-glass: type a reason first. Access lasts 24 hours.";

export type BreakGlassUseKind = "LIVE_RECORD" | "SEALED_COPIES";

/** The administrator a grant is looked up for. `actAsId` is only for the audit rows. */
export type BreakGlassActor = { userId: string; actAsId?: string; viaClubsAdministrator?: true };

type Client = Pick<Prisma.TransactionClient, "healthSnapshotBreakGlass">;

/** Ids are short opaque strings. Anything else is caller-supplied text and is never stored. */
export function idShaped(value: string | null | undefined) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : "invalid";
}

/**
 * The administrator's unexpired grants for these people: person id to the grant that lasts longest. A grant
 * belongs to the administrator who typed it, so another administrator's grant never counts.
 */
export async function activeGrantsFor(
  actor: BreakGlassActor,
  personIds: readonly string[],
  now: Date,
  client: Client = getPrisma(),
): Promise<Map<string, string>> {
  const unique = [...new Set(personIds)];
  if (unique.length === 0) return new Map();
  const grants = await client.healthSnapshotBreakGlass.findMany({
    where: { userId: actor.userId, personId: { in: unique }, expiresAt: { gt: now } },
    orderBy: { expiresAt: "asc" },
    select: { id: true, personId: true },
  });
  // Ascending, so the grant that lasts longest is written last and wins.
  return new Map(grants.flatMap((grant) => (grant.personId ? [[grant.personId, grant.id] as const] : [])));
}

/**
 * Audits a refusal for lack of break-glass: who (with `actAsId` when acting), what was attempted, the ids involved
 * and the reason `BREAK_GLASS_REQUIRED`. Never throws and never carries a health value.
 */
export async function auditBreakGlassRefusal(input: {
  actor: BreakGlassActor;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  eventId?: string;
  metadata: Record<string, unknown>;
}) {
  try {
    await writeAuditLog({
      actorUserId: input.actor.userId,
      ...(input.eventId ? { eventId: input.eventId } : {}),
      action: input.action,
      entityType: input.entityType,
      entityId: idShaped(input.entityId),
      summary: input.summary,
      metadata: {
        viewerKind: "SYSTEM_ADMIN",
        ...(input.actor.actAsId ? { actAsId: input.actor.actAsId } : {}),
        ...(input.actor.viaClubsAdministrator ? { actorRole: "CLUBS_ADMINISTRATOR" } : {}),
        ...input.metadata,
        reason: "BREAK_GLASS_REQUIRED",
      },
    });
  } catch (error) {
    const action = "Auditing a refusal for lack of break-glass failed";
    logError(action, error);
  }
}

/** The refusal every read path throws. */
export function breakGlassRequired() {
  return new HealthRecordError("BREAK_GLASS_REQUIRED", BREAK_GLASS_REQUIRED_MESSAGE);
}

/**
 * Records one use of a grant inside the caller's transaction, next to the audit row that names the same grant. The
 * caller writes this before it opens any value, so a failure here means nothing is opened.
 */
export async function recordBreakGlassUse(
  tx: Prisma.TransactionClient,
  input: { grantId: string; userId: string; personId: string; kind: BreakGlassUseKind },
) {
  await tx.healthBreakGlassUse.create({ data: input, select: { id: true } });
}
