import "server-only";

import { z } from "zod";
import { logError } from "@/lib/logger";
import { AccessDeniedError } from "@/modules/access/authorization";
import { VisitingClubError, type VisitingClubErrorCode } from "@/modules/visiting-clubs/repository";

const statusByCode: Record<VisitingClubErrorCode, number> = {
  INVITE_UNAVAILABLE: 410,
  INVITE_NOT_FOUND: 404,
  EMAIL_MISMATCH: 403,
  EVENT_NOT_FOUND: 404,
  EMAIL_NOT_CONFIGURED: 409,
  REQUEST_NOT_FOUND: 404,
  ALREADY_DECIDED: 409,
  INVALID_REASON: 400,
  ACCOUNT_NOT_FOUND: 409,
  EVENT_ENDED: 409,
};

const noStore = { "Cache-Control": "private, no-store, max-age=0" };

/** One place that turns a visiting club failure into a response. Never echoes a stack or a database message. */
export function visitingClubApiError(error: unknown, action: string) {
  if (error instanceof z.ZodError) {
    return Response.json(
      { error: "INVALID_REQUEST", message: error.issues[0]?.message ?? "Check the form and try again.", issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) },
      { status: 400, headers: noStore },
    );
  }
  if (error instanceof SyntaxError) {
    return Response.json({ error: "INVALID_JSON", message: "The request was not valid." }, { status: 400, headers: noStore });
  }
  if (error instanceof AccessDeniedError) {
    return Response.json({ error: error.code, message: error.message }, { status: error.status, headers: noStore });
  }
  if (error instanceof VisitingClubError) {
    return Response.json({ error: error.code, message: error.message }, { status: statusByCode[error.code], headers: noStore });
  }
  logError(`${action} failed.`, error);
  return Response.json({ error: "VISITING_CLUB_FAILED", message: "That could not be completed. Please try again." }, { status: 500, headers: noStore });
}
