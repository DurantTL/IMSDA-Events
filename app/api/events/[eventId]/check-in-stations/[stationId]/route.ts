import { requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { applyStationPrivateHeaders, stationJson } from "@/modules/checkin-stations/http";
import { revokeStation } from "@/modules/checkin-stations/repository";
import { staffStationApiError } from "@/modules/checkin-stations/staff-http";
import { findActiveMembership } from "@/modules/events/repository";
import { withRequestContext } from "@/lib/request-context";

type RouteContext = { params: Promise<{ eventId: string; stationId: string }> };

async function deleteHandler(request: Request, context: RouteContext) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return applyStationPrivateHeaders(originError);
  try {
    const { eventId, stationId } = await context.params;
    const access = await requirePermission(
      await getCurrentSession(),
      eventId,
      "MANAGE_CHECK_IN",
      findActiveMembership,
    );
    await revokeStation(eventId, stationId, access.user.id);
    return stationJson({ revoked: true });
  } catch (error) {
    return staffStationApiError(error);
  }
}

export const DELETE = withRequestContext(deleteHandler);
