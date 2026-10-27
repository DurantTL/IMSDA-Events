import { stationLookupSchema, STATION_LOOKUP_LIMIT_PER_MINUTE } from "@/modules/checkin-stations/domain";
import { stationPostHandler } from "@/modules/checkin-stations/http";
import { lookupStationFamily } from "@/modules/checkin-stations/service";
import { checkCheckInStationLookupRateLimit } from "@/modules/rate-limit/service";

export const POST = stationPostHandler(
  {
    schema: stationLookupSchema,
    rateLimit: (station) => checkCheckInStationLookupRateLimit(station.station.id, STATION_LOOKUP_LIMIT_PER_MINUTE),
  },
  async ({ station, input }) => ({ family: await lookupStationFamily(station, input) }),
);
