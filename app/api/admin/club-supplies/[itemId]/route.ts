import { withRequestContext } from "@/lib/request-context";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { clubSupplyApiError } from "@/modules/club-supplies/api-errors";
import { setClubSupplyItemActive } from "@/modules/club-supplies/repository";
import { clubSupplyItemActiveSchema } from "@/modules/club-supplies/schemas";
import { requireClubsAdministration } from "@/modules/organizations/access";

/** Marks one catalog item active or inactive (#531), system administrators and Clubs Administrators (#1232). */
async function patchHandler(request: Request, context: { params: Promise<{ itemId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const actor = await requireClubsAdministration();
    const { itemId } = await context.params;
    const { isActive } = clubSupplyItemActiveSchema.parse(await request.json());
    return Response.json({ items: await setClubSupplyItemActive(itemId, isActive, actor.id) });
  } catch (error) {
    return clubSupplyApiError(error, "Updating a club supply item");
  }
}

export const PATCH = withRequestContext(patchHandler);
