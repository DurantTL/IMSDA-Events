import { requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { requestError } from "@/modules/cancellation-requests/api";
import { statusFilterSchema } from "@/modules/cancellation-requests/domain";
import { listCancellationRequests } from "@/modules/cancellation-requests/repository";
import { findActiveMembership } from "@/modules/events/repository";
import { withRequestContext } from "@/lib/request-context";

/** The cancellation request queue for one event (#170). MANAGE_FINANCE on the event in the URL, like the rules page. */
async function getHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await context.params;
    await requirePermission(await getCurrentSession(), eventId, "MANAGE_FINANCE", findActiveMembership);
    const filter = statusFilterSchema.parse(new URL(request.url).searchParams.get("status") ?? undefined);
    return Response.json({ requests: await listCancellationRequests(eventId, filter) });
  } catch (error) {
    return requestError(error, "Listing cancellation requests");
  }
}

export const GET = withRequestContext(getHandler);
