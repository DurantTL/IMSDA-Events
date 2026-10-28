import { cookies } from "next/headers";
import { requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import {
  CHECK_IN_STATION_COOKIE_NAME,
  startStationSchema,
  stationCookieOptions,
} from "@/modules/checkin-stations/domain";
import {
  applyStationPrivateHeaders,
  readStationBody,
  stationJson,
} from "@/modules/checkin-stations/http";
import { startStation, stopStationByToken } from "@/modules/checkin-stations/repository";
import { staffStationApiError } from "@/modules/checkin-stations/staff-http";
import { findActiveMembership } from "@/modules/events/repository";
import { withRequestContext } from "@/lib/request-context";

type RouteContext = { params: Promise<{ eventId: string }> };

/**
 * Starts a station for this event on the calling device. This route needs the ordinary staff session; the cookie it
 * sets belongs to the station alone and no staff route accepts it.
 */
async function postHandler(request: Request, context: RouteContext) {
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
    const input = startStationSchema.parse(await readStationBody(request));
    const cookieStore = await cookies();
    const previousToken = cookieStore.get(CHECK_IN_STATION_COOKIE_NAME)?.value;
    const now = new Date();
    const { token, station } = await startStation(eventId, access.user, input.label, now);
    // One station per device: starting a new one stops the one this device still held.
    await stopStationByToken(previousToken, now);
    cookieStore.set(
      CHECK_IN_STATION_COOKIE_NAME,
      token,
      stationCookieOptions(station.expiresAt, now, process.env.NODE_ENV === "production"),
    );
    return stationJson({ station: { id: station.id, label: station.label, expiresAt: station.expiresAt.toISOString() } });
  } catch (error) {
    return staffStationApiError(error);
  }
}

export const POST = withRequestContext(postHandler);
