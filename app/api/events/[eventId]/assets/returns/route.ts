import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { assetApiError, assetJson, requireAssetStaff } from "@/modules/issued-assets/api";
import { returnAssets } from "@/modules/issued-assets/returns-service";
import { withRequestContext } from "@/lib/request-context";

const maximumBodyBytes = 16 * 1024;

/**
 * Check-out: record that items came back, were lost, or came back damaged (#214). A typed code, a scan and an offline
 * sheet sent later all arrive here and run the same transactional service; a saved retry key makes a repeat write
 * nothing twice. Check-in staff.
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
    return assetJson(await returnAssets(eventId, staff.userId, JSON.parse(raw)));
  } catch (error) {
    return assetApiError(error, "Recording the return");
  }
}

export const POST = withRequestContext(postHandler);
