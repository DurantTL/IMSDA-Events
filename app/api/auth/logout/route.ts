import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { signOutThisBrowser } from "@/modules/account-merge/sign-out";
import { withRequestContext } from "@/lib/request-context";

async function postHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;

  // Ends the staff session and any active act-as (#442). With one sign-in on it
  // also ends this browser's attendee session (#1092). See `signOutThisBrowser`.
  const ok = await signOutThisBrowser("staff");
  // Cookies are cleared either way; a failed revoke is reported after that.
  return ok ? Response.json({ ok: true }) : Response.json({ ok: false }, { status: 500 });
}

export const POST = withRequestContext(postHandler);
