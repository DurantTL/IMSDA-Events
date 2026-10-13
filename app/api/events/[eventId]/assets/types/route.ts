import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { assetApiError, assetJson, requireAssetStaff } from "@/modules/issued-assets/api";
import { applyAssetTypeAction } from "@/modules/issued-assets/service";
import { getCatalogView } from "@/modules/issued-assets/view";
import { withRequestContext } from "@/lib/request-context";

/** Create or edit a kind of issued item. Event setup permission. */
async function postHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId } = await context.params;
    const staff = await requireAssetStaff(eventId, "CONFIGURE_EVENT");
    const result = await applyAssetTypeAction(eventId, staff.userId, await request.json());
    return assetJson({ result, catalog: await getCatalogView(eventId) }, 200);
  } catch (error) {
    return assetApiError(error, "Saving the kind of item");
  }
}

export const POST = withRequestContext(postHandler);
