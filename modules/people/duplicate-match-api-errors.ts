import { z } from "zod";
import { AccessDeniedError } from "@/modules/access/authorization";
import { PersonMatchCandidateError } from "@/modules/people/duplicate-match-repository";
import { PersonMergeResolutionError } from "@/modules/people/person-merge-domain";
import { PersonMergeError } from "@/modules/people/person-merge-repository";
import { logError } from "@/lib/logger";

export function duplicateMatchApiError(error: unknown, action: string) {
  if (error instanceof z.ZodError) {
    return Response.json({
      error: "INVALID_MATCH_CANDIDATE_REQUEST",
      message: error.issues[0]?.message ?? "Review the request and try again.",
      issues: error.issues,
    }, { status: 400 });
  }
  if (error instanceof AccessDeniedError) {
    return Response.json(
      { error: error.code, message: error.message },
      { status: error.status },
    );
  }
  if (error instanceof PersonMatchCandidateError) {
    const status = error.code === "NOT_FOUND" ? 404 : error.code === "INVALID_REASON" ? 400 : 409;
    return Response.json({ error: error.code, message: error.message }, { status });
  }
  if (error instanceof PersonMergeResolutionError) {
    return Response.json({
      error: "RESOLUTION_FAILED",
      message: "The merge records for these people could not be followed safely. Ask a developer to check them.",
    }, { status: 409 });
  }
  if (error instanceof PersonMergeError) {
    const status = error.code === "NOT_FOUND" ? 404 : error.code === "INVALID_REASON" ? 400 : 409;
    return Response.json({ error: error.code, message: error.message }, { status });
  }
  logError(`${action} failed`, error);
  return Response.json({
    error: "MATCH_CANDIDATE_REQUEST_FAILED",
    message: "The duplicate review queue could not be updated.",
  }, { status: 500 });
}
