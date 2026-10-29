import { withRequestContext } from "@/lib/request-context";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { clubOrderApiError } from "@/modules/club-orders/api-errors";
import { setOrderHonorLineQuantity } from "@/modules/club-orders/repository";
import { clubOrderListQuantitySchema } from "@/modules/club-orders/schemas";
import { requireClubSupplyEditAccess } from "@/modules/club-supplies/access";

type RouteContext = { params: Promise<{ organizationId: string; honorId: string }> };

/**
 * Changes one honor-with-no-catalog-item line of the order helper list (#1330):
 * a positive quantity adds or changes it, 0 or `null` removes it. Same guards
 * as the catalog item lines: directors and deputies only.
 */
async function putHandler(request: Request, context: RouteContext) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { organizationId, honorId } = await context.params;
    const actor = await requireClubSupplyEditAccess(organizationId);
    const { quantity } = clubOrderListQuantitySchema.parse(await request.json());
    return Response.json({ line: await setOrderHonorLineQuantity(organizationId, honorId, quantity, actor) });
  } catch (error) {
    return clubOrderApiError(error, "Saving the order list");
  }
}

export const PUT = withRequestContext(putHandler);
