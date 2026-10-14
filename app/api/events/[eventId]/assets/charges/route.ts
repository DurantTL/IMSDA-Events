import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { assetApiError, assetJson, requireAnyAssetPermission } from "@/modules/issued-assets/api";
import { postCharge, waiveCharge } from "@/modules/issued-assets/money-service";
import { withRequestContext } from "@/lib/request-context";

/**
 * Charges and waivers for lost or damaged items (#214). Check-in staff may record only the kind's standard replacement
 * fee; any other charge and every waiver needs finance (MANAGE_FINANCE) or an event administrator (CONFIGURE_EVENT), and a
 * waiver needs a reason. The service enforces the same rules again. A charge posts to the registration through the
 * existing adjustment path; nothing is collected or refunded here.
 */
async function postHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId } = await context.params;
    const staff = await requireAnyAssetPermission(eventId, ["MANAGE_CHECK_IN", "MANAGE_FINANCE", "CONFIGURE_EVENT"]);
    const body: unknown = await request.json();
    const action = typeof body === "object" && body !== null && "action" in body ? (body as { action: unknown }).action : null;
    const options = { canManageMoney: staff.canManageMoney };
    if (action === "waive") return assetJson(await waiveCharge(eventId, staff.userId, body, options));
    return assetJson(await postCharge(eventId, staff.userId, body, options));
  } catch (error) {
    return assetApiError(error, "Recording the charge");
  }
}

export const POST = withRequestContext(postHandler);
