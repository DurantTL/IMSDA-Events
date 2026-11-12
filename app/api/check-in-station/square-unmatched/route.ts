import { STATION_LOOKUP_LIMIT_PER_MINUTE, stationSquareUnmatchedSchema } from "@/modules/checkin-stations/domain";
import { stationPostHandler } from "@/modules/checkin-stations/http";
import { listStationSquareCandidates } from "@/modules/checkin-stations/service";
import { checkCheckInStationLookupRateLimit } from "@/modules/rate-limit/service";

export const POST = stationPostHandler(
  {
    schema: stationSquareUnmatchedSchema,
    capability: "payments",
    rateLimit: (station) => checkCheckInStationLookupRateLimit(station.station.id, STATION_LOOKUP_LIMIT_PER_MINUTE),
  },
  async ({ station, input }) => listStationSquareCandidates(station, input.registrationId),
);
