import "server-only";

import { Prisma } from "@prisma/client";
import { z } from "zod";
import { AccessDeniedError, requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { findActiveMembership } from "@/modules/events/repository";
import { logError } from "@/lib/logger";
import { StaffDraftError } from "@/modules/staff-registration-drafts/errors";

/** Every staff draft action needs MANAGE_REGISTRATION on the event, checked on the server. */
export async function authorizeStaffDrafts(eventId: string) {
  return requirePermission(await getCurrentSession(), eventId, "MANAGE_REGISTRATION", findActiveMembership);
}

export function staffDraftApiError(error: unknown) {
  if (error instanceof z.ZodError || error instanceof SyntaxError) {
    return Response.json({ error: "INVALID_DRAFT", message: "Check the highlighted answers and try again." }, { status: 400 });
  }
  if (error instanceof AccessDeniedError) {
    return Response.json({ error: error.code, message: error.message }, { status: error.status });
  }
  if (error instanceof StaffDraftError) {
    return Response.json({ error: error.code, message: error.message }, { status: error.status });
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2034" || error.code === "P2028")) {
    return Response.json({ error: "DRAFT_BUSY", message: "That draft is busy. Try again in a moment." }, { status: 409 });
  }
  logError("Staff registration draft request failed", error);
  return Response.json({ error: "STAFF_DRAFT_REQUEST_FAILED", message: "That could not be done. Nothing was sent." }, { status: 500 });
}
