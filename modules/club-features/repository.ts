import "server-only";

import { getPrisma } from "@/lib/prisma";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { clubOptionalFeatureDefinitions, type ClubOptionalFeatureKey } from "@/modules/club-features/domain";

/**
 * Optional club features (#1709): which ones a club has switched on. Off is the absence of a row, so a club that never
 * switches one on has nothing stored. Switching is audited with who did it. The callers (the Club settings route, the
 * pages) have already checked the club role; this only reads and writes the switch.
 */

/** Who switched it: the attendee account of a director or deputy, or a staff user acting as the club's director (#442). */
export type ClubFeatureActor = { accountId: string } | { userId: string; actAsId?: string; viaClubsAdministrator?: true };

export class ClubFeatureError extends Error {
  constructor(public readonly code: "NOT_FOUND", message: string) {
    super(message);
    this.name = "ClubFeatureError";
  }
}

export async function isClubFeatureEnabled(organizationId: string, featureKey: ClubOptionalFeatureKey): Promise<boolean> {
  const row = await getPrisma().clubOptionalFeature.findUnique({
    where: { organizationId_featureKey: { organizationId, featureKey } },
    select: { id: true },
  });
  return row !== null;
}

/** Every feature of the club that is on, as keys in the order the list names them. */
export async function listEnabledClubFeatures(organizationId: string): Promise<ClubOptionalFeatureKey[]> {
  const rows = await getPrisma().clubOptionalFeature.findMany({ where: { organizationId }, select: { featureKey: true } });
  return rows.map((row) => row.featureKey).filter((key): key is ClubOptionalFeatureKey => key in clubOptionalFeatureDefinitions);
}

/**
 * Switches one feature on or off for one active club, with an audit entry only when something changed (switching on a
 * feature already on, or off one already off, writes nothing). Returns whether it is on afterwards.
 */
export async function setClubFeature(organizationId: string, featureKey: ClubOptionalFeatureKey, enabled: boolean, actor: ClubFeatureActor): Promise<boolean> {
  const title = clubOptionalFeatureDefinitions[featureKey].title;
  await getPrisma().$transaction(async (tx) => {
    const club = await tx.organization.findUnique({ where: { id: organizationId }, select: { type: true, isActive: true } });
    if (!club || club.type !== "CLUB" || !club.isActive) throw new ClubFeatureError("NOT_FOUND", "That club could not be found.");
    const who = "accountId" in actor
      ? { enabledByAccountId: actor.accountId }
      : { enabledByUserId: actor.userId };
    const metadata = {
      organizationId,
      featureKey,
      ...("accountId" in actor
        ? { actorAttendeeAccountId: actor.accountId }
        : { ...(actor.actAsId ? { actAsId: actor.actAsId } : {}), ...(actor.viaClubsAdministrator ? { actorRole: "CLUBS_ADMINISTRATOR" } : {}) }),
    };
    const changed = enabled
      ? (await tx.clubOptionalFeature.createMany({ data: [{ organizationId, featureKey, ...who }], skipDuplicates: true })).count > 0
      : (await tx.clubOptionalFeature.deleteMany({ where: { organizationId, featureKey } })).count > 0;
    if (!changed) return;
    await writeAuditLog({
      ...("userId" in actor ? { actorUserId: actor.userId } : {}),
      action: enabled ? "CLUB_FEATURE_ENABLED" : "CLUB_FEATURE_DISABLED",
      entityType: "ClubOptionalFeature",
      entityId: organizationId,
      summary: `${enabled ? "Turned on" : "Turned off"} ${title} for the club.`,
      metadata,
    }, tx);
  });
  return enabled;
}
