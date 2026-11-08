import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { actorAttribution, requireRosterAccess } from "@/modules/club-rosters/access";
import { readRosterJson, rosterApiError } from "@/modules/club-rosters/api-errors";
import { canSwitchClubFeatures, CLUB_OPTIONAL_FEATURE_KEYS } from "@/modules/club-features/domain";
import { ClubFeatureError, listEnabledClubFeatures, setClubFeature } from "@/modules/club-features/repository";
import { clubFeaturesInputSchema } from "@/modules/club-features/schemas";
import { withRequestContext } from "@/lib/request-context";

/**
 * The club's director or deputy switches optional club features on or off (#1709). Off is the default. Each real change
 * is audited. Another club, a registrar, a reporter, an Area Coordinator and staff without an act-as get a refusal.
 */
async function putHandler(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { organizationId } = await context.params;
    const access = await requireRosterAccess(organizationId, new Date(), "editProfile");
    if (!canSwitchClubFeatures(access.capabilities)) {
      return Response.json({ error: "ROLE_NOT_ALLOWED", message: "Your club role doesn't include this. Ask your club director." }, { status: 403 });
    }
    const input = clubFeaturesInputSchema.parse(await readRosterJson(request));
    const attribution = actorAttribution(access.actor);
    // A Clubs Administrator acting as the director is recorded as one, as the health pages do.
    const actor = access.actor.kind === "STAFF_ACTING" && access.actor.viaClubsAdministrator ? { ...attribution, viaClubsAdministrator: true as const } : attribution;
    for (const key of CLUB_OPTIONAL_FEATURE_KEYS) {
      const wanted = input.features[key];
      if (wanted !== undefined) await setClubFeature(organizationId, key, wanted, actor);
    }
    return Response.json({ enabled: await listEnabledClubFeatures(organizationId) });
  } catch (error) {
    if (error instanceof ClubFeatureError) return Response.json({ error: error.code, message: error.message }, { status: 404 });
    return rosterApiError(error, "Saving the club features");
  }
}

export const PUT = withRequestContext(putHandler);
