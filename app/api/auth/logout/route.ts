import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { signOutThisBrowser } from "@/modules/account-merge/sign-out";
import { withRequestContext } from "@/lib/request-context";

async function postHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;

  // Ends the staff session and any active act-as (#442). With one sign-in on it
  // also ends this browser's attendee session (#1092). See `signOutThisBrowser`.
  await signOutThisBrowser("staff");
  return Response.json({ ok: true });
}

export const POST = withRequestContext(postHandler);
