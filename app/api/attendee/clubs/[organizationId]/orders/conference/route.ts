import { liveJson } from "@/lib/live-list-response";
import { withRequestContext } from "@/lib/request-context";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { clubOrderApiError } from "@/modules/club-orders/api-errors";
import { loadClubConferenceOrders, submitConferenceOrder } from "@/modules/club-orders/conference-repository";
import { conferenceOrderSubmitSchema } from "@/modules/club-orders/schemas";
import { requireClubOrdersAccess, requireClubSupplyEditAccess } from "@/modules/club-supplies/access";

type RouteContext = { params: Promise<{ organizationId: string }> };

/** The club's conference order section (#1688): the items and prices, who is billed, and the club's own conference orders. The Orders screen's gate. */
async function getHandler(_request: Request, context: RouteContext) {
  try {
    const { organizationId } = await context.params;
    const access = await requireClubOrdersAccess(organizationId);
    return liveJson({ ...(await loadClubConferenceOrders(organizationId)), canEdit: access.mode === "EDIT" });
  } catch (error) {
    return clubOrderApiError(error, "Loading the conference order");
  }
}

/**
 * Submits a conference order for patches and pins (#1688). A director or deputy (or a staff "act as" director) of this club only:
 * the club comes from the URL and the gate is checked against it, so another club's order can never be placed. The order goes
 * to the youth department and is billed to the club's sponsoring church once filled.
 */
async function postHandler(request: Request, context: RouteContext) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { organizationId } = await context.params;
    const actor = await requireClubSupplyEditAccess(organizationId);
    const body = conferenceOrderSubmitSchema.parse(await request.json());
    return Response.json({ order: await submitConferenceOrder(organizationId, body, actor) }, { status: 201 });
  } catch (error) {
    return clubOrderApiError(error, "Submitting the conference order");
  }
}

export const GET = withRequestContext(getHandler);
export const POST = withRequestContext(postHandler);
