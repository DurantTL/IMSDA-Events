import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { requireClubOrganizationAdministration } from "@/modules/organizations/access";
import { organizationApiError } from "@/modules/organizations/api-errors";
import { revokeDirectorGrant } from "@/modules/organizations/director-grants-repository";
import { revokeDirectorGrantInputSchema } from "@/modules/organizations/director-grants-schemas";
import { withRequestContext } from "@/lib/request-context";

async function patchHandler(
  request: Request,
  context: { params: Promise<{ organizationId: string; grantId: string }> },
) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { organizationId, grantId } = await context.params;
    const actor = await requireClubOrganizationAdministration(organizationId);
    const input = revokeDirectorGrantInputSchema.parse(await request.json());
    return Response.json(
      await revokeDirectorGrant(organizationId, grantId, input.reason, actor.id),
    );
  } catch (error) {
    return organizationApiError(error, "Revoking a club director");
  }
}

export const PATCH = withRequestContext(patchHandler);
