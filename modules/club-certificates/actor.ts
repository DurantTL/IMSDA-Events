import { actorAttribution, type ClubActor } from "@/modules/club-rosters/access";
import type { ClubFeatureActor } from "@/modules/club-features/repository";

/** Who printed or voided a certificate, for the record and its audit entry; a Clubs Administrator acting as the director is marked as one. */
export function certificateActor(actor: ClubActor): ClubFeatureActor {
  const attribution = actorAttribution(actor);
  return actor.kind === "STAFF_ACTING" && actor.viaClubsAdministrator ? { ...attribution, viaClubsAdministrator: true as const } as ClubFeatureActor : attribution;
}
