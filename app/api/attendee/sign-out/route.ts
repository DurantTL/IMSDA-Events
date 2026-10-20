import { withRequestContext } from "@/lib/request-context";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { signOutThisBrowser } from "@/modules/account-merge/sign-out";

async function postHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;

  // Ends the attendee session. With one sign-in on it also ends this browser's
  // staff session and any act-as (#1092). See `signOutThisBrowser`.
  const ok = await signOutThisBrowser("attendee");
  // Cookies are cleared either way; a failed revoke is reported after that.
  return ok ? Response.json({ ok: true }) : Response.json({ ok: false }, { status: 500 });
}

export const POST = withRequestContext(postHandler);
