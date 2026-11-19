import { z } from "zod";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import {
  DiscordAlertSettingsError,
  removeDiscordWebhook,
  saveDiscordGroups,
  saveDiscordWebhook,
} from "@/modules/operations/discord-alert-settings";
import { logError } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";

/**
 * Alerts to Discord (#2048): system administrators only, like the other platform-settings writes. The server checks
 * on every call. The webhook address arrives in a PUT body and is never returned, logged or audited.
 */
async function requireSystemAdmin() {
  const { user } = await getCurrentSession();
  if (!user || user.globalRole !== "SYSTEM_ADMIN") return null;
  return user;
}

function forbidden() {
  return Response.json(
    { error: "SYSTEM_ADMIN_REQUIRED", message: "Only a system administrator can change the Discord alert settings." },
    { status: 403 },
  );
}

const addressSchema = z.object({ address: z.string().max(1000) }).strict();
const groupsSchema = z
  .object({
    groups: z.object({ "site-health": z.boolean(), deploys: z.boolean(), backups: z.boolean(), "practice-runs": z.boolean() }).strict(),
  })
  .strict();

function failure(error: unknown, what: string) {
  if (error instanceof DiscordAlertSettingsError) {
    return Response.json({ error: "DISCORD_ALERTS_INVALID", message: error.message }, { status: 400 });
  }
  if (error instanceof z.ZodError || error instanceof SyntaxError) {
    return Response.json({ error: "INVALID_REQUEST", message: "That request was not understood." }, { status: 400 });
  }
  // Fixed words only: the error is not echoed and the body is never logged.
  logError(`${what} failed`, error);
  return Response.json({ error: "DISCORD_ALERTS_FAILED", message: "The change could not be saved." }, { status: 500 });
}

async function putHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  const user = await requireSystemAdmin();
  if (!user) return forbidden();
  try {
    const input = addressSchema.parse(await request.json());
    return Response.json({ settings: await saveDiscordWebhook(input.address, user.id) });
  } catch (error) {
    return failure(error, "Saving the Discord alert address");
  }
}

async function patchHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  const user = await requireSystemAdmin();
  if (!user) return forbidden();
  try {
    const input = groupsSchema.parse(await request.json());
    return Response.json({ settings: await saveDiscordGroups(input.groups, user.id) });
  } catch (error) {
    return failure(error, "Changing the Discord alert groups");
  }
}

async function deleteHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  const user = await requireSystemAdmin();
  if (!user) return forbidden();
  try {
    return Response.json({ settings: await removeDiscordWebhook(user.id) });
  } catch (error) {
    return failure(error, "Removing the Discord alert address");
  }
}

export const PUT = withRequestContext(putHandler);
export const PATCH = withRequestContext(patchHandler);
export const DELETE = withRequestContext(deleteHandler);
