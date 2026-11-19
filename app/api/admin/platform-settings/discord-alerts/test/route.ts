import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { getDiscordAlertSettingsView, sendDiscordTestMessage } from "@/modules/operations/discord-alert-settings";
import { logError } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";

/** Sends one test line to the Discord channel (#2048). System administrators only; the server checks on every call. */
async function postHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  const { user } = await getCurrentSession();
  if (!user || user.globalRole !== "SYSTEM_ADMIN") {
    return Response.json(
      { error: "SYSTEM_ADMIN_REQUIRED", message: "Only a system administrator can send a test message." },
      { status: 403 },
    );
  }
  try {
    const result = await sendDiscordTestMessage(user.id);
    return Response.json({ result, settings: await getDiscordAlertSettingsView() });
  } catch (error) {
    logError("Sending the Discord test message failed", error);
    return Response.json({ error: "DISCORD_TEST_FAILED", message: "The test message could not be sent." }, { status: 500 });
  }
}

export const POST = withRequestContext(postHandler);
