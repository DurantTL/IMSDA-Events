import { stationSquareMatchSchema } from "@/modules/checkin-stations/domain";
import { stationPostHandler } from "@/modules/checkin-stations/http";
import { matchStationSquarePayment, stationPaymentHistoryAfterWrite } from "@/modules/checkin-stations/service";

export const POST = stationPostHandler(
  { schema: stationSquareMatchSchema, capability: "payments" },
  async ({ station, input }) => {
    const payment = await matchStationSquarePayment(station, input);
    return { payment, ...(await stationPaymentHistoryAfterWrite(station.station.eventId, input.registrationId)) };
  },
);
