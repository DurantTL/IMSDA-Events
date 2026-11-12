import { stationSquareNoteSchema } from "@/modules/checkin-stations/domain";
import { stationPostHandler } from "@/modules/checkin-stations/http";
import { noteStationSquareAppPayment, stationPaymentHistoryAfterWrite } from "@/modules/checkin-stations/service";

/**
 * A station notes a card payment someone took in the Square app, for finance to match later. Deliberately open to a
 * check-in-only station (no `capability: "payments"`; Caleb, November 12, 2026): the note records no payment and moves no
 * money, it only writes an audited reminder for finance, so the volunteer at the desk can leave one.
 */
export const POST = stationPostHandler(
  { schema: stationSquareNoteSchema },
  async ({ station, input }) => {
    const payment = await noteStationSquareAppPayment(station, input);
    return { payment, ...(await stationPaymentHistoryAfterWrite(station.station.eventId, input.registrationId)) };
  },
);
