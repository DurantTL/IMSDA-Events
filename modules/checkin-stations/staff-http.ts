import "server-only";

import { AccessDeniedError } from "@/modules/access/authorization";
import { CheckInStationError } from "@/modules/checkin-stations/repository";
import { stationApiError, stationJson } from "@/modules/checkin-stations/http";

/** Error mapping shared by the two staff-side station routes (start, revoke). */
export function staffStationApiError(error: unknown) {
  if (error instanceof AccessDeniedError) {
    return stationJson({ error: error.code, message: error.message }, { status: error.status });
  }
  if (error instanceof CheckInStationError) {
    return stationJson(
      { error: error.code, message: error.message },
      { status: error.code === "EVENT_NOT_FOUND" || error.code === "STATION_NOT_FOUND" ? 404 : 409 },
    );
  }
  return stationApiError(error);
}
