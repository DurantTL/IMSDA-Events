import "server-only";

import { writeAuditLog } from "@/modules/audit/audit-service";

export const PERSON_CROSS_EVENT_READ_ACTION = "PERSON_CROSS_EVENT_READ";
/** The most ids one read entry carries; the rest is only counted. */
export const CROSS_EVENT_READ_ID_CAP = 100;

export type CrossEventReadSurface =
  | "MERGED_PERSON_VIEW"
  | "ACTIVE_MERGES_LIST"
  | "OPEN_MATCH_CANDIDATES";

/**
 * Records that an identity read crossed an event boundary (#128). Ids only:
 * the actor, the surface, and the ids of what was returned. Never a name,
 * contact detail or reason. It is written before the data is handed back, and
 * a failure to write it fails the read, so a global read cannot go unrecorded.
 * `Person` is global, so these entries carry no `eventId`.
 */
export async function auditCrossEventIdentityRead(input: {
  actorUserId: string;
  surface: CrossEventReadSurface;
  entityId?: string;
  resultIds: readonly string[];
  extra?: Record<string, string | number | string[]>;
}) {
  if (!input.actorUserId) throw new Error("A cross-event identity read needs an actor to audit.");
  const resultIds = input.resultIds.slice(0, CROSS_EVENT_READ_ID_CAP);
  await writeAuditLog({
    actorUserId: input.actorUserId,
    action: PERSON_CROSS_EVENT_READ_ACTION,
    entityType: "PersonIdentityRead",
    entityId: input.entityId,
    summary: `Read ${input.resultIds.length} identity record(s) across events (${input.surface}).`,
    metadata: {
      surface: input.surface,
      resultCount: input.resultIds.length,
      resultIds,
      truncated: input.resultIds.length > resultIds.length,
      ...(input.extra ?? {}),
    },
  });
}
