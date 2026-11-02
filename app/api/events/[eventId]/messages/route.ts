import { requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { messagingApiError } from "@/modules/communications/api-errors";
import { getMessagingWorkspace } from "@/modules/communications/messaging-repository";
import { parseDeliveryQuery } from "@/modules/communications/delivery-log-model";
import { findActiveMembership } from "@/modules/events/repository";
import { withRequestContext } from "@/lib/request-context";

/** The delivery log and counts, for the workspace's light refresh while messages are queued or sending (#860). */
async function getHandler(
  request: Request,
  context: { params: Promise<{ eventId: string }> },
) {
  try {
    const { eventId } = await context.params;
    await requirePermission(
      await getCurrentSession(),
      eventId,
      "MANAGE_COMMUNICATIONS",
      findActiveMembership,
    );
    // The log's status filter and page come from the same address names the page uses (#1492).
    const params = new URL(request.url).searchParams;
    const messaging = await getMessagingWorkspace(eventId, parseDeliveryQuery({ status: params.get("status") ?? undefined, page: params.get("page") ?? undefined }));
    return Response.json({ messaging }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return messagingApiError(error, "Refreshing the delivery log");
  }
}

export const GET = withRequestContext(getHandler);
