import { z } from "zod";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { getCurrentAttendee } from "@/modules/attendee-accounts/current-attendee";
import { attendeeSignInStepPending } from "@/modules/attendee-accounts/portal-second-step";
import { listDirectedClubs } from "@/modules/organizations/director-access";
import { leaderChoicesSchema } from "@/modules/leader-directory/domain";
import { saveLeaderChoices } from "@/modules/leader-directory/repository";
import { withRequestContext } from "@/lib/request-context";

const privateHeaders = { "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache" };

function json(body: unknown, init?: ResponseInit) {
  return Response.json(body, { ...init, headers: { ...privateHeaders, ...init?.headers } });
}

/**
 * A leader's own directory choices (#1707): listed or not, share email, share phone. Signed-in attendee only, and the
 * only row it can write is the caller's own: the account comes from the session, never from the request body.
 */
async function patchHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  const current = await getCurrentAttendee();
  if (current.via !== "attendee" || !current.account) {
    return json({ message: "Sign in to change your leader directory choices." }, { status: 401 });
  }
  if (await attendeeSignInStepPending()) {
    return json({ code: "SECOND_STEP_REQUIRED", message: "Finish two-step sign-in to change your choices." }, { status: 403 });
  }
  // Only an account with an active club leader grant has these choices (the profile card is shown to the same accounts).
  if ((await listDirectedClubs(current.account.id)).length === 0) {
    return json({ message: "Leader directory choices are for club leaders." }, { status: 403 });
  }
  try {
    const input = leaderChoicesSchema.parse(await request.json());
    return json({ choices: await saveLeaderChoices(current.account.id, input) });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return json({ message: "Send listed, shareEmail and sharePhone, each true or false." }, { status: 400 });
    }
    throw error;
  }
}

export const PATCH = withRequestContext(patchHandler);
