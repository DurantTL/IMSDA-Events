import { rosterApiError } from "@/modules/club-rosters/api-errors";
import { MasterGuideError } from "@/modules/master-guide/domain";

/** Route answers for Master Guide tracking (#1698). Anything that is not its own error goes through the roster's. */
export function masterGuideApiError(error: unknown, action: string) {
  if (error instanceof MasterGuideError) {
    const status = error.code === "NOT_FOUND" || error.code === "FEATURE_OFF" ? 404
      : error.code === "ALREADY_A_CANDIDATE" || error.code === "WRONG_STATUS" ? 409
      : 400;
    return Response.json({ error: error.code, message: error.message }, { status });
  }
  return rosterApiError(error, action);
}
