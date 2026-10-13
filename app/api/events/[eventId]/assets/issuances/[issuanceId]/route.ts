import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { assetApiError, assetJson, requireAssetStaff } from "@/modules/issued-assets/api";
import { applyIssuanceAction } from "@/modules/issued-assets/service";
import { withRequestContext } from "@/lib/request-context";

/** Transfer, replace or correct one issue. Nothing is overwritten: the old issue ends and history is appended. Check-in staff. */
async function postHandler(request: Request, context: { params: Promise<{ eventId: string; issuanceId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId, issuanceId } = await context.params;
    const staff = await requireAssetStaff(eventId, "MANAGE_CHECK_IN");
    const result = await applyIssuanceAction(eventId, staff.userId, issuanceId, await request.json());
    return assetJson(result, 200);
  } catch (error) {
    return assetApiError(error, "Changing the issue");
  }
}

export const POST = withRequestContext(postHandler);
