import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { requireClubOrganizationAdministration } from "@/modules/organizations/access";
import { organizationApiError } from "@/modules/organizations/api-errors";
import { updateClubProfile } from "@/modules/organizations/club-profile-repository";
import { clubProfileInputSchema } from "@/modules/organizations/club-profile-schemas";
import { withRequestContext } from "@/lib/request-context";

/** Conference staff save a club's profile (#375). Audited. */
async function patchHandler(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { organizationId } = await context.params;
    const actor = await requireClubOrganizationAdministration(organizationId);
    const input = clubProfileInputSchema.parse(await request.json());
    return Response.json({ profile: await updateClubProfile(organizationId, input, { userId: actor.id }) });
  } catch (error) {
    return organizationApiError(error, "Saving a club profile");
  }
}

export const PATCH = withRequestContext(patchHandler);
