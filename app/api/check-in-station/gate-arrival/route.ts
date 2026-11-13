import { gateArrivalSchema } from "@/modules/checkin-stations/domain";
import { recordGateArrival } from "@/modules/checkin-stations/gate-service";
import { stationPostHandler } from "@/modules/checkin-stations/http";

/** Gate mode (#1684): note "arrived at gate" for one person. Never a check-in. */
export const POST = stationPostHandler(
  { schema: gateArrivalSchema },
  async ({ station, input }) => recordGateArrival(station, input),
);
