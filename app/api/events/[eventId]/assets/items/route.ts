import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { assetApiError, assetJson, requireAssetStaff } from "@/modules/issued-assets/api";
import { applyAssetAction } from "@/modules/issued-assets/service";
import { getCatalogView } from "@/modules/issued-assets/view";
import { withRequestContext } from "@/lib/request-context";

/** Add one item or lot, add a numbered range (K-201 to K-260), or edit an item. Event setup permission. */
async function postHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId } = await context.params;
    const staff = await requireAssetStaff(eventId, "CONFIGURE_EVENT");
    const result = await applyAssetAction(eventId, staff.userId, await request.json());
    return assetJson({ result, catalog: await getCatalogView(eventId) }, 200);
  } catch (error) {
    return assetApiError(error, "Saving the item");
  }
}

export const POST = withRequestContext(postHandler);
