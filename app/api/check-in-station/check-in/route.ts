import { stationCheckInSchema } from "@/modules/checkin-stations/domain";
import { stationPostHandler } from "@/modules/checkin-stations/http";
import { checkInStationFamily } from "@/modules/checkin-stations/service";

export const POST = stationPostHandler(
  { schema: stationCheckInSchema },
  async ({ station, input }) => ({ results: await checkInStationFamily(station, input) }),
);
