import { stationSquareNoteSchema } from "@/modules/checkin-stations/domain";
import { stationPostHandler } from "@/modules/checkin-stations/http";
import { noteStationSquareAppPayment, stationPaymentHistoryAfterWrite } from "@/modules/checkin-stations/service";

export const POST = stationPostHandler(
  { schema: stationSquareNoteSchema },
  async ({ station, input }) => {
    const payment = await noteStationSquareAppPayment(station, input);
    return { payment, ...(await stationPaymentHistoryAfterWrite(station.station.eventId, input.registrationId)) };
  },
);
