import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { assetApiError, assetJson, requireAssetStaff } from "@/modules/issued-assets/api";
import { recordDeposit, settleDeposit } from "@/modules/issued-assets/money-service";
import { withRequestContext } from "@/lib/request-context";

/**
 * Cash key deposits (#214). `record` notes the cash the desk took for a holder's open items; `settle` records what is
 * handed back and what is kept once every covered item is accounted for (the server decides the amounts). The system
 * records; it never moves money. Check-in staff.
 */
async function postHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId } = await context.params;
    const staff = await requireAssetStaff(eventId, "MANAGE_CHECK_IN");
    const body: unknown = await request.json();
    const action = typeof body === "object" && body !== null && "action" in body ? (body as { action: unknown }).action : null;
    if (action === "settle") return assetJson(await settleDeposit(eventId, staff.userId, body));
    return assetJson(await recordDeposit(eventId, staff.userId, body), 200);
  } catch (error) {
    return assetApiError(error, "Recording the deposit");
  }
}

export const POST = withRequestContext(postHandler);
