import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { assetApiError, assetJson, requireAnyAssetPermission } from "@/modules/issued-assets/api";
import { recordOutcomeCorrection } from "@/modules/issued-assets/corrections";
import { recordLateDepositRefund } from "@/modules/issued-assets/money-service";
import { withRequestContext } from "@/lib/request-context";

/**
 * Corrections of a recorded outcome and write-offs (#214): a lost key found later (LOST to RETURNED), a return that was
 * really a loss, the fate of the original of a replacement, or a loss written off without a charge. Append-only, with a
 * required reason. Finance (MANAGE_FINANCE) or event administrators (CONFIGURE_EVENT); the service checks it again. Nothing
 * is refunded, charged or settled by a correction.
 */
async function postHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId } = await context.params;
    const staff = await requireAnyAssetPermission(eventId, ["MANAGE_FINANCE", "CONFIGURE_EVENT"]);
    const body: unknown = await request.json();
    const options = { canManageMoney: staff.canManageMoney };
    const action = typeof body === "object" && body !== null && "action" in body ? (body as { action: unknown }).action : null;
    if (action === "refund_after_correction") return assetJson(await recordLateDepositRefund(eventId, staff.userId, body, options));
    return assetJson(await recordOutcomeCorrection(eventId, staff.userId, body, options));
  } catch (error) {
    return assetApiError(error, "Correcting the outcome");
  }
}

export const POST = withRequestContext(postHandler);
