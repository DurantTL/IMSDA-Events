import { cookies } from "next/headers";
import { withRequestContext } from "@/lib/request-context";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { passkeyApiError } from "@/modules/access/passkey-api";
import { PASSKEY_CHALLENGE_MINUTES } from "@/modules/passkeys/domain";
import { beginCombinedPasskeySignIn } from "@/modules/account-merge/combined-passkey-sign-in";
import { COMBINED_PASSKEY_SIGN_IN_COOKIE } from "@/modules/account-merge/combined-passkey-sign-in-cookie";
import { applyRateLimitHeaders, mergeRateLimitOutcomes } from "@/modules/rate-limit/domain";
import { checkAttendeePasskeySignInRateLimit, checkStaffPasskeySignInRateLimit } from "@/modules/rate-limit/service";

/**
 * Starts the one-sign-in passkey prompt (#1085): any of this site's passkeys, staff or
 * attendee, tied to this browser. Limited by both existing passkey sign-in policies, so
 * the combined button is never looser than the two it replaces.
 */
async function postHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const rateLimit = mergeRateLimitOutcomes(
      await checkStaffPasskeySignInRateLimit(request, "options"),
      await checkAttendeePasskeySignInRateLimit(request, "options"),
    );
    if (!rateLimit.allowed) {
      return applyRateLimitHeaders(Response.json({ error: "RATE_LIMITED", message: "Too many sign-in attempts. Try again later." }, { status: 429 }), rateLimit);
    }
    const { options, handle } = await beginCombinedPasskeySignIn(request.headers.get("origin"));
    (await cookies()).set(COMBINED_PASSKEY_SIGN_IN_COOKIE, handle, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/api/sign-in/passkey",
      maxAge: PASSKEY_CHALLENGE_MINUTES * 60,
    });
    return applyRateLimitHeaders(Response.json({ options }, { headers: { "Cache-Control": "no-store" } }), rateLimit);
  } catch (error) {
    return passkeyApiError(error, "Starting passkey sign-in");
  }
}

export const POST = withRequestContext(postHandler);
