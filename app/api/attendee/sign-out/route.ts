import { withRequestContext } from "@/lib/request-context";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { signOutThisBrowser } from "@/modules/account-merge/sign-out";

async function postHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;

  // Ends the attendee session. With one sign-in on it also ends this browser's
  // staff session and any act-as (#1092). See `signOutThisBrowser`.
  await signOutThisBrowser("attendee");
  return Response.json({ ok: true });
}

export const POST = withRequestContext(postHandler);
