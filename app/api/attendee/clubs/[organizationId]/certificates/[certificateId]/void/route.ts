import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { actorAttribution, requireRosterAccess } from "@/modules/club-rosters/access";
import { rosterApiError } from "@/modules/club-rosters/api-errors";
import { voidClubCertificate } from "@/modules/club-certificates/repository";
import { withRequestContext } from "@/lib/request-context";

/**
 * The club's director or deputy voids one certificate this club printed (#2052). The check page then says it was
 * withdrawn; the record is kept. Only while the club has certificates switched on. A certificate of another club, one
 * already voided and a made-up id all get the same "not found". Audited.
 */
async function postHandler(request: Request, context: { params: Promise<{ organizationId: string; certificateId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { organizationId, certificateId } = await context.params;
    const access = await requireRosterAccess(organizationId, new Date(), "editProfile");
    const attribution = actorAttribution(access.actor);
    const actor = access.actor.kind === "STAFF_ACTING" && access.actor.viaClubsAdministrator ? { ...attribution, viaClubsAdministrator: true as const } : attribution;
    const voided = await voidClubCertificate(organizationId, certificateId, access.capabilities, actor);
    if (!voided) return Response.json({ error: "NOT_FOUND", message: "That certificate could not be found." }, { status: 404 });
    return Response.json({ voided: true });
  } catch (error) {
    return rosterApiError(error, "Voiding a certificate");
  }
}

export const POST = withRequestContext(postHandler);
