import { withRequestContext } from "@/lib/request-context";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { parseMoneyCents } from "@/modules/club-orders/conference-orders";
import { clubSupplyApiError } from "@/modules/club-supplies/api-errors";
import { ClubSupplyError, setClubSupplyItemOrdering } from "@/modules/club-supplies/repository";
import { clubSupplyItemOrderingSchema } from "@/modules/club-supplies/schemas";
import { requireClubsAdministration } from "@/modules/organizations/access";

/**
 * Sets who supplies one catalog item and its unit price (#1688), system administrators and Clubs Administrators (#1232).
 * A conference item needs a price; changing it never alters an order already submitted.
 */
async function patchHandler(request: Request, context: { params: Promise<{ itemId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const actor = await requireClubsAdministration();
    const { itemId } = await context.params;
    const body = clubSupplyItemOrderingSchema.parse(await request.json());
    const unitPriceCents = body.supplier === "CONFERENCE" ? parseMoneyCents(body.unitPrice ?? "") : null;
    if (body.supplier === "CONFERENCE" && (unitPriceCents === null || (body.unitPrice ?? "").trim() === "")) {
      throw new ClubSupplyError("INVALID_PRICE", "Enter a price in dollars and cents for a conference-supplied item, such as 1.25.");
    }
    return Response.json({ items: await setClubSupplyItemOrdering(itemId, { supplier: body.supplier, unitPriceCents }, actor.id) });
  } catch (error) {
    return clubSupplyApiError(error, "Updating a club supply item's supplier");
  }
}

export const PATCH = withRequestContext(patchHandler);
