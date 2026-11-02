import { logError } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { signOutOtherSessions } from "@/modules/attendee-accounts/account-service";
import { getCurrentAttendee } from "@/modules/attendee-accounts/current-attendee";
import { accountNeedsSignInStep } from "@/modules/attendee-accounts/sign-in-gate";
import { listActiveAttendeeSessions } from "@/modules/attendee-accounts/session-store";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { applyRateLimitHeaders } from "@/modules/rate-limit/domain";
import { checkAttendeeSignOutOthersRateLimit } from "@/modules/rate-limit/service";

/**
 * "Sign out everywhere else" on the profile page (#221). Signs every other session of the signed-in attendee
 * account out and keeps this one. It only protects the account, so it needs no recent second step, but the
 * session must have finished its sign-in step (a password alone cannot sign the owner out everywhere).
 */
async function postHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { account, via, sessionId } = await getCurrentAttendee();
    if (!account || via !== "attendee" || !sessionId) {
      return Response.json(
        { error: "SIGN_IN_REQUIRED", message: "Sign in to manage your signed-in devices." },
        { status: 401 },
      );
    }
    // A session that still owes its sign-in step (the emailed code, or its authenticator or passkey) cannot
    // sign the owner's other devices out: a password alone must not be able to kick the owner off.
    if ((await accountNeedsSignInStep(account.id, sessionId)) !== "OK") {
      return Response.json(
        { error: "SECOND_STEP_REQUIRED", message: "Finish two-step sign-in to manage your signed-in devices." },
        { status: 403 },
      );
    }
    const rateLimit = await checkAttendeeSignOutOthersRateLimit(request, account.id);
    if (!rateLimit.allowed) {
      return applyRateLimitHeaders(Response.json({
        error: "RATE_LIMITED",
        message: "Too many attempts. Wait a few minutes and try again.",
      }, { status: 429 }), rateLimit);
    }
    const revoked = await signOutOtherSessions(account.id, sessionId);
    await writeAuditLog({
      action: "ATTENDEE_SIGNED_OUT_OTHER_SESSIONS",
      entityType: "AttendeeAccount",
      entityId: account.id,
      summary: "An attendee signed out their other devices.",
      metadata: { actorAttendeeAccountId: account.id, sessionId, revokedSessions: revoked },
    });
    return applyRateLimitHeaders(Response.json({
      ok: true,
      revoked,
      sessions: await listActiveAttendeeSessions(account.id, sessionId),
    }), rateLimit);
  } catch (error) {
    logError("Signing out other sessions failed", error);
    return Response.json(
      { error: "SESSION_REQUEST_FAILED", message: "Your other devices could not be signed out." },
      { status: 500 },
    );
  }
}

export const POST = withRequestContext(postHandler);
