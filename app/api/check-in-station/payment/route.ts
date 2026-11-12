import { stationPaymentSchema } from "@/modules/checkin-stations/domain";
import { stationPostHandler } from "@/modules/checkin-stations/http";
import { recordStationPayment, stationPaymentHistoryAfterWrite } from "@/modules/checkin-stations/service";

export const POST = stationPostHandler(
  { schema: stationPaymentSchema, capability: "payments" },
  async ({ station, input }) => {
    const payment = await recordStationPayment(station, input);
    return { payment, ...(await stationPaymentHistoryAfterWrite(station.station.eventId, input.registrationId)) };
  },
);
