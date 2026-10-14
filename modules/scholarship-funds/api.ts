import { z } from "zod";
import { AccessDeniedError } from "@/modules/access/authorization";
import { ScholarshipFundError } from "@/modules/scholarship-funds/domain";
import { logError } from "@/lib/logger";

/** The response for a refused scholarship fund request; the same shape the adjustment routes use. */
export function scholarshipFundErrorResponse(error: ScholarshipFundError) {
  const status = error.code.endsWith("_NOT_FOUND") && error.code !== "SPONSOR_NOT_FOUND"
    ? 404
    : error.code === "SPONSOR_REQUIRED" || error.code === "SPONSOR_NOT_FOUND"
      ? 400
      : 409;
  return Response.json({ error: error.code, message: error.message }, { status });
}

export function scholarshipFundApiError(error: unknown, action: string) {
  if (error instanceof z.ZodError) {
    return Response.json({ error: "INVALID_SCHOLARSHIP_FUND_REQUEST", message: error.issues[0]?.message ?? "Review the entry.", issues: error.issues }, { status: 400 });
  }
  if (error instanceof SyntaxError) {
    return Response.json({ error: "INVALID_SCHOLARSHIP_FUND_REQUEST", message: "The request could not be read." }, { status: 400 });
  }
  if (error instanceof AccessDeniedError) {
    return Response.json({ error: error.code, message: error.message }, { status: error.status });
  }
  if (error instanceof ScholarshipFundError) return scholarshipFundErrorResponse(error);
  logError(`${action} failed`, error);
  return Response.json({ error: "SCHOLARSHIP_FUND_FAILED", message: "The scholarship fund could not be updated." }, { status: 500 });
}
