import { z } from "zod";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { logError } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";
import {
  EmailSuppressionError,
  listActiveSuppressions,
  reenableSuppressedAddress,
} from "@/modules/communications/email-suppression";

/**
 * System management > Email > Email health (#863): the addresses that are not being sent to, and re-enabling one. System
 * administrators only, checked here and again inside `reenableSuppressedAddress`. Re-enabling is a state change, so it
 * is same-origin only and audited (who and when; ids only, never the address).
 */
async function requireSystemAdmin() {
  const { user } = await getCurrentSession();
  if (!user || user.globalRole !== "SYSTEM_ADMIN") return null;
  return user;
}

function forbidden() {
  return Response.json(
    { error: "SYSTEM_ADMIN_REQUIRED", message: "Only a system administrator can manage suppressed addresses." },
    { status: 403 },
  );
}

const reenableBodySchema = z.object({ suppressionId: z.string().trim().min(1).max(64) }).strict();

async function getHandler() {
  const user = await requireSystemAdmin();
  if (!user) return forbidden();
  return Response.json(await listActiveSuppressions());
}

async function postHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  const user = await requireSystemAdmin();
  if (!user) return forbidden();
  try {
    const input = reenableBodySchema.parse(await request.json());
    const result = await reenableSuppressedAddress({ suppressionId: input.suppressionId, actor: user });
    return Response.json({ changed: result.changed, ...(await listActiveSuppressions()) });
  } catch (error) {
    if (error instanceof EmailSuppressionError) {
      return Response.json(
        { error: error.code, message: error.message },
        { status: error.code === "SYSTEM_ADMIN_REQUIRED" ? 403 : 404 },
      );
    }
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: "INVALID_REQUEST", message: "Choose an address to re-enable." },
        { status: 400 },
      );
    }
    if (error instanceof SyntaxError) {
      return Response.json({ error: "INVALID_JSON", message: "The request is not valid JSON." }, { status: 400 });
    }
    logError("Re-enabling a suppressed address failed", error);
    return Response.json(
      { error: "REENABLE_FAILED", message: "The address could not be re-enabled." },
      { status: 500 },
    );
  }
}

export const GET = withRequestContext(getHandler);
export const POST = withRequestContext(postHandler);
