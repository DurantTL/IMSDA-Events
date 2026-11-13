import { gateLookupSchema, STATION_LOOKUP_LIMIT_PER_MINUTE } from "@/modules/checkin-stations/domain";
import { gateLookup } from "@/modules/checkin-stations/gate-service";
import { stationPostHandler } from "@/modules/checkin-stations/http";
import { checkCheckInStationLookupRateLimit } from "@/modules/rate-limit/service";

/** Gate mode (#1684): look up a scanned pass or a typed name. Refused while the event's gate mode is off. */
export const POST = stationPostHandler(
  {
    schema: gateLookupSchema,
    rateLimit: (station) => checkCheckInStationLookupRateLimit(station.station.id, STATION_LOOKUP_LIMIT_PER_MINUTE),
  },
  async ({ station, input }) => gateLookup(station, input),
);
