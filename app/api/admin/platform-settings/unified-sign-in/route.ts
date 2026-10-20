import { z } from "zod";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { isUnifiedSignInEnabled } from "@/modules/account-merge/account-link";
import { getSignInLinkCheck, setUnifiedSignIn } from "@/modules/account-merge/sign-in-switch";
import { logError } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";

/** The one-sign-in switch (#554, #1083): system administrators only, like the other platform-settings writes. */
async function requireSystemAdmin() {
  const { user } = await getCurrentSession();
  if (!user || user.globalRole !== "SYSTEM_ADMIN") return null;
  return user;
}

function forbidden() {
  return Response.json(
    { error: "SYSTEM_ADMIN_REQUIRED", message: "Only a system administrator can change the one sign-in switch." },
    { status: 403 },
  );
}

const bodySchema = z.object({ enabled: z.boolean() }).strict();

async function getHandler() {
  const user = await requireSystemAdmin();
  if (!user) return forbidden();
  return Response.json({ enabled: await isUnifiedSignInEnabled(), linkCheck: await getSignInLinkCheck() });
}

async function patchHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  const user = await requireSystemAdmin();
  if (!user) return forbidden();
  try {
    const input = bodySchema.parse(await request.json());
    await setUnifiedSignIn(input.enabled, user.id);
    return Response.json({ enabled: input.enabled, linkCheck: await getSignInLinkCheck() });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return Response.json(
        { error: "INVALID_REQUEST", message: "Send {\"enabled\": true} or {\"enabled\": false}." },
        { status: 400 },
      );
    }
    logError("Changing the one sign-in switch failed", error);
    return Response.json(
      { error: "UNIFIED_SIGN_IN_UPDATE_FAILED", message: "The switch could not be changed." },
      { status: 500 },
    );
  }
}

export const GET = withRequestContext(getHandler);
export const PATCH = withRequestContext(patchHandler);
