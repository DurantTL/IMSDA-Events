import { stationSquareNoteSchema } from "@/modules/checkin-stations/domain";
import { stationPostHandler } from "@/modules/checkin-stations/http";
import { noteStationSquareAppPayment } from "@/modules/checkin-stations/service";

export const POST = stationPostHandler(
  { schema: stationSquareNoteSchema },
  async ({ station, input }) => ({ payment: await noteStationSquareAppPayment(station, input) }),
);
