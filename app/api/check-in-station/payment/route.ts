import { stationPaymentSchema } from "@/modules/checkin-stations/domain";
import { stationPostHandler } from "@/modules/checkin-stations/http";
import { recordStationPayment } from "@/modules/checkin-stations/service";

export const POST = stationPostHandler(
  { schema: stationPaymentSchema, capability: "payments" },
  async ({ station, input }) => ({ payment: await recordStationPayment(station, input) }),
);
