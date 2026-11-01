import { cookies } from "next/headers";
import { logError, logInfo } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { findSwitchableAttendeeAccountForStaff } from "@/modules/attendee-accounts/current-attendee";
import { attendeePublicUrl } from "@/modules/attendee-accounts/public-navigation";
import {
  ATTENDEE_SESSION_LIFETIME_SECONDS,
  createAttendeeSession,
  revokeAttendeeSession,
} from "@/modules/attendee-accounts/session-store";
import { attendeeSessionCookie } from "@/modules/security/session-cookies";

async function postHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;

  try {
    const { user } = await getCurrentSession();
    if (!user) {
      return Response.json(
        { error: "AUTHENTICATION_REQUIRED", message: "Sign in to the staff workspace first." },
        { status: 401 },
      );
    }

    const account = await findSwitchableAttendeeAccountForStaff(user.email, user.id);
    if (!account) {
      return Response.json(
        {
          error: "ATTENDEE_ACCOUNT_NOT_AVAILABLE",
          message: "No active verified attendee account matches your staff email address.",
        },
        { status: 404 },
      );
    }

    const cookieStore = await cookies();
    await revokeAttendeeSession(attendeeSessionCookie.read(cookieStore));
    const attendeeSession = await createAttendeeSession(
      account.id,
      request.headers.get("user-agent"),
    );
    attendeeSessionCookie.set(cookieStore, attendeeSession.token, { expires: attendeeSession.expiresAt, maxAge: ATTENDEE_SESSION_LIFETIME_SECONDS });
    logInfo("Staff switched to their matching attendee account.", {
      actorUserId: user.id,
      attendeeAccountId: account.id,
    });

    return new Response(null, {
      status: 303,
      headers: {
        location: attendeePublicUrl("/account").toString(),
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    logError("Staff attendee-account switch failed", error);
    return Response.json(
      {
        error: "ATTENDEE_SWITCH_FAILED",
        message: "The attendee account could not be opened. Try again.",
      },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}

export const POST = withRequestContext(postHandler);
