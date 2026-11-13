import { z } from "zod";
import { AccessDeniedError } from "@/modules/access/authorization";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import {
  applyStaffPersonalCorrection,
  getPersonalValuesForStaff,
  staffPersonalCorrectionSchema,
  StaffPersonalCorrectionError,
} from "@/modules/attendee-accounts/profile-personal-staff";
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

function failure(error: unknown, what: string) {
  if (error instanceof AccessDeniedError) {
    return json({ error: error.code, message: error.message }, { status: error.status });
  }
  if (error instanceof StaffPersonalCorrectionError) {
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
  logError(`${what} failed`, error);
  return json({ error: "REQUEST_FAILED", message: "The request could not be completed." }, { status: 500 });
}

/**
 * One account's current address and emergency contact, for a system administrator who opened the correction (#1512).
 * Current values are fetched one account at a time and never bulk-loaded. The read is audited before the values are returned.
 */
async function getHandler(request: Request) {
  try {
    const actor = await requireSystemAdministrator();
    const accountId = new URL(request.url).searchParams.get("accountId")?.trim() ?? "";
    if (!accountId || accountId.length > 100) {
      return json({ error: "INVALID_REQUEST", message: "Name the account to correct." }, { status: 400 });
    }
    return json(await getPersonalValuesForStaff(actor.id, accountId));
  } catch (error) {
    return failure(error, "Reading an attendee's personal details for correction");
  }
}

/**
 * A system administrator's correction of an attendee's address or emergency contact (#1512). A reason and the statement
 * that the person asked for the change are required, and the values the person was looking at must still be the stored
 * ones (otherwise 409).
 */
async function postHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const actor = await requireSystemAdministrator();
    const input = staffPersonalCorrectionSchema.parse(await request.json());
    const result = await applyStaffPersonalCorrection(actor.id, input);
    return json({ changedFields: result.changedFields });
  } catch (error) {
    return failure(error, "Correcting an attendee's personal details");
  }
}

export const GET = withRequestContext(getHandler);
export const POST = withRequestContext(postHandler);
