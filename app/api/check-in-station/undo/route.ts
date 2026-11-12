import { stationUndoSchema } from "@/modules/checkin-stations/domain";
import { stationPostHandler } from "@/modules/checkin-stations/http";
import { undoStationCheckIn } from "@/modules/checkin-stations/service";

export const POST = stationPostHandler(
  { schema: stationUndoSchema, capability: "checkIn" },
  async ({ station, input }) => undoStationCheckIn(station, input.attendeeId),
);
