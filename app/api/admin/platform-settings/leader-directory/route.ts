import { z } from "zod";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { getLeaderDirectorySwitch, setLeaderDirectoryEnabled } from "@/modules/leader-directory/repository";
import { logError } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";

/** The leader directory switch (#1707): system administrators only, like the other platform-settings writes. */
async function requireSystemAdmin() {
  const { user } = await getCurrentSession();
  if (!user || user.globalRole !== "SYSTEM_ADMIN") return null;
  return user;
}

function forbidden() {
  return Response.json(
    { error: "SYSTEM_ADMIN_REQUIRED", message: "Only a system administrator can change the leader directory switch." },
    { status: 403 },
  );
}

const bodySchema = z.object({ enabled: z.boolean() }).strict();

async function getHandler() {
  if (!(await requireSystemAdmin())) return forbidden();
  return Response.json(await getLeaderDirectorySwitch());
}

async function patchHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  const user = await requireSystemAdmin();
  if (!user) return forbidden();
  try {
    const input = bodySchema.parse(await request.json());
    return Response.json(await setLeaderDirectoryEnabled(input.enabled, user.id));
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return Response.json({ error: "INVALID_REQUEST", message: "Send {\"enabled\": true} or {\"enabled\": false}." }, { status: 400 });
    }
    logError("Changing the leader directory switch failed", error);
    return Response.json({ error: "LEADER_DIRECTORY_UPDATE_FAILED", message: "The switch could not be changed." }, { status: 500 });
  }
}

export const GET = withRequestContext(getHandler);
export const PATCH = withRequestContext(patchHandler);
