import { rosterApiError } from "@/modules/club-rosters/api-errors";
import { StaffTrainingError } from "@/modules/staff-training/repository";

/** Route errors for staff training (#1697): its own refusals as 404, everything else through the roster's mapping. */
export function staffTrainingApiError(error: unknown, action: string) {
  if (error instanceof StaffTrainingError) {
    return Response.json({ error: error.code, message: error.message }, { status: 404 });
  }
  return rosterApiError(error, action);
}
