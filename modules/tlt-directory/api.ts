import "server-only";

import { ZodError } from "zod";
import { logError } from "@/lib/logger";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { RosterBodyError, readRosterJson } from "@/modules/club-rosters/api-errors";
import { currentTltDirector, type TltDirectorActor } from "@/modules/tlt-directory/access";
import { TltDirectoryError } from "@/modules/tlt-directory/domain";

const noStore = { "Cache-Control": "private, no-store" };

/**
 * The gate every TLT directory POST goes through, in this order: cross-origin refusal, then the TLT director check
 * (anyone else, signed in or not, gets the same 404 so the routes don't reveal themselves), then the JSON body.
 */
export async function tltDirectorRequest(request: Request): Promise<{ actor: TltDirectorActor; body: unknown } | { response: Response }> {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return { response: originError };
  const actor = await currentTltDirector();
  if (!actor) return { response: Response.json({ message: "Not found." }, { status: 404, headers: noStore }) };
  try {
    return { actor, body: await readRosterJson(request) };
  } catch (error) {
    return { response: tltApiError(error, "Reading a TLT directory request") };
  }
}

export function tltApiError(error: unknown, action: string) {
  if (error instanceof ZodError) {
    return Response.json({ error: "INVALID_TLT_REQUEST", message: error.issues[0]?.message ?? "Check the details and try again.", issues: error.issues }, { status: 400, headers: noStore });
  }
  if (error instanceof RosterBodyError) {
    return Response.json({ error: error.code, message: error.message }, { status: 400, headers: noStore });
  }
  if (error instanceof TltDirectoryError) {
    const status = error.code === "NOT_A_TLT" || error.code === "ENTRY_NOT_FOUND" ? 404 : error.code === "NAME_TAKEN" || error.code === "STALE_CLUB_YEAR" ? 409 : 400;
    return Response.json({ error: error.code, message: error.message }, { status, headers: noStore });
  }
  logError(`${action} failed`, error);
  return Response.json({ error: "TLT_DIRECTORY_FAILED", message: "That could not be done. Try again." }, { status: 500, headers: noStore });
}
