import { logError } from "@/lib/logger";
import { stationCheckInSchema } from "@/modules/checkin-stations/domain";
import { stationPostHandler } from "@/modules/checkin-stations/http";
import { checkInStationFamily, stationHandOutList, type StationHandOut } from "@/modules/checkin-stations/service";
import { sealHealthSnapshotAfterCheckIn } from "@/modules/health-records/snapshot-hooks";

export const POST = stationPostHandler(
  { schema: stationCheckInSchema },
  async ({ station, input }) => {
    const results = await checkInStationFamily(station, input);
    // The arrival is recorded first. Sealing the person's health copy (#924) comes after it, as at the desk, and
    // never fails the check-in.
    for (const result of results) {
      if (result.status !== "CHECKED_IN" && result.status !== "ALREADY_CHECKED_IN") continue;
      try {
        await sealHealthSnapshotAfterCheckIn(station.station.eventId, result.attendeeId);
      } catch (error) {
        logError("Health snapshot after station check-in failed", error);
      }
    }
    // What to hand over for the people newly checked in just now; it never fails the check-in.
    let handOut: StationHandOut = { lines: [], keyTypes: [], rooms: [] };
    try {
      handOut = await stationHandOutList(
        station,
        results.filter((result) => result.status === "CHECKED_IN").map((result) => result.attendeeId),
      );
    } catch (error) {
      logError("Hand out list after station check-in failed", error);
    }
    return { results, handOut: handOut.lines, handOutParts: { keyTypes: handOut.keyTypes, rooms: handOut.rooms } };
  },
);
