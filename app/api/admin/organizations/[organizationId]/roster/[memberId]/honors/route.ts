import { withRequestContext } from "@/lib/request-context";
import { memberHonorApiError } from "@/modules/honors/member-honor-api-errors";
import { listMemberHonorHistory } from "@/modules/honors/member-honor-repository";
import { requireClubOrganizationAdministration } from "@/modules/organizations/access";

type RouteContext = { params: Promise<{ organizationId: string; memberId: string }> };

/** One member's full honor history for staff (#591), voided entries included. Read only. */
async function getHandler(_request: Request, context: RouteContext) {
  try {
    const { organizationId, memberId } = await context.params;
    await requireClubOrganizationAdministration(organizationId);
    return Response.json(await listMemberHonorHistory(organizationId, memberId));
  } catch (error) {
    return memberHonorApiError(error, "Loading this person's honor history");
  }
}

export const GET = withRequestContext(getHandler);
