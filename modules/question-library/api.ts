import { ZodError } from "zod";
import { logError } from "@/lib/logger";
import { AccessDeniedError } from "@/modules/access/authorization";
import { readRosterJson, RosterBodyError } from "@/modules/club-rosters/api-errors";
import { QuestionLibraryError } from "@/modules/question-library/domain";

export { readRosterJson as readQuestionLibraryJson };

export const questionLibraryNoStore = { "Cache-Control": "private, no-store, max-age=0" };

/** One error mapper for the question library routes. It never logs or echoes a request body: an error carries a code and a fixed message only. */
export function questionLibraryApiError(error: unknown, action: string) {
  if (error instanceof ZodError) return Response.json({ error: "INVALID_QUESTION_LIBRARY_REQUEST", message: error.issues[0]?.message ?? "Check the saved question and try again." }, { status: 400 });
  if (error instanceof RosterBodyError) return Response.json({ error: error.code, message: error.message }, { status: 400 });
  if (error instanceof AccessDeniedError) return Response.json({ error: error.code, message: error.message }, { status: error.status });
  if (error instanceof QuestionLibraryError) {
    return Response.json({ error: error.code, message: error.message }, { status: error.code === "ITEM_NOT_FOUND" ? 404 : 400, headers: questionLibraryNoStore });
  }
  logError(action, error);
  return Response.json({ error: "QUESTION_LIBRARY_REQUEST_FAILED", message: "The question library request could not be completed." }, { status: 500 });
}
