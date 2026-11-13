import { z } from "zod";
import { AccessDeniedError } from "@/modules/access/authorization";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import {
  applyStaffProfileCorrection,
  staffCorrectionSchema,
  StaffCorrectionError,
} from "@/modules/attendee-accounts/profile-change-staff";
import { requireSystemAdministrator } from "@/modules/people/duplicate-match-access";
import { logError } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";

const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
};

function json(body: unknown, init?: ResponseInit) {
  return Response.json(body, { ...init, headers: { ...privateHeaders, ...init?.headers } });
}

/**
 * A staff correction of an attendee's saved name, phone or shirt size (#1512). System administrators only, a reason is
 * required, and the values the person was looking at must still be the stored ones (otherwise 409).
 */
async function postHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const actor = await requireSystemAdministrator();
    const input = staffCorrectionSchema.parse(await request.json());
    const result = await applyStaffProfileCorrection(actor.id, input);
    return json({ changedFields: result.changedFields });
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      return json({ error: error.code, message: error.message }, { status: error.status });
    }
    if (error instanceof StaffCorrectionError) {
      const status = error.code === "NOT_FOUND" ? 404 : error.code === "STALE" ? 409 : 400;
      return json({ error: error.code, message: error.message }, { status });
    }
    if (error instanceof z.ZodError) {
      return json({
        error: "INVALID_CORRECTION",
        message: error.issues[0]?.message ?? "Review the correction and try again.",
        issues: error.issues,
      }, { status: 400 });
    }
    logError("Correcting an attendee profile failed", error);
    return json({ error: "CORRECTION_FAILED", message: "The correction could not be saved." }, { status: 500 });
  }
}

export const POST = withRequestContext(postHandler);
