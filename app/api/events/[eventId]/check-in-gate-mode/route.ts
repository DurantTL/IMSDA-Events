import { requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { gateModeToggleSchema } from "@/modules/checkin-stations/domain";
import { setGateMode } from "@/modules/checkin-stations/gate-service";
import { applyStationPrivateHeaders, readStationBody, stationJson } from "@/modules/checkin-stations/http";
import { staffStationApiError } from "@/modules/checkin-stations/staff-http";
import { findActiveMembership } from "@/modules/events/repository";
import { withRequestContext } from "@/lib/request-context";

type RouteContext = { params: Promise<{ eventId: string }> };

/** Staff turn gate mode (#1684) on or off for one event. Off by default; turning it off keeps logged arrivals. */
async function putHandler(request: Request, context: RouteContext) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return applyStationPrivateHeaders(originError);
  try {
    const { eventId } = await context.params;
    const access = await requirePermission(
      await getCurrentSession(),
      eventId,
      "MANAGE_CHECK_IN",
      findActiveMembership,
    );
    const input = gateModeToggleSchema.parse(await readStationBody(request));
    const result = await setGateMode(eventId, access.user.id, input.enabled);
    return stationJson(result);
  } catch (error) {
    return staffStationApiError(error);
  }
}

export const PUT = withRequestContext(putHandler);
