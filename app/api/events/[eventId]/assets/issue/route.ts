import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { assetApiError, assetJson, requireAssetStaff } from "@/modules/issued-assets/api";
import { issueAssets } from "@/modules/issued-assets/service";
import { withRequestContext } from "@/lib/request-context";

const maximumBodyBytes = 16 * 1024;

/**
 * Issue one or several items to one holder. A typed code, a scanned code and an offline entry sent later all arrive
 * here and run the same transactional service. Check-in staff.
 */
async function postHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId } = await context.params;
    const staff = await requireAssetStaff(eventId, "MANAGE_CHECK_IN");
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > maximumBodyBytes) {
      return assetJson({ error: "REQUEST_TOO_LARGE", message: "That request is too large." }, 413);
    }
    const result = await issueAssets(eventId, staff.userId, JSON.parse(raw));
    return assetJson(result, 200);
  } catch (error) {
    return assetApiError(error, "Issuing the items");
  }
}

export const POST = withRequestContext(postHandler);
