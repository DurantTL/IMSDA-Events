import { z } from "zod";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { logError } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";
import { EventEmailPauseError, listEventEmailStates, setEventEmailPaused } from "@/modules/communications/event-email-pause";
import { centralSenderInputSchema, updateCentralSender } from "@/modules/system-admin/central-sender";

/**
 * System management > Email (#1043): the central sender and pausing one event's email. Both are global, so they are
 * gated on the system administrator role here and again inside `setEventEmailPaused`; event staff have no route to
 * either.
 */
async function requireSystemAdmin() {
  const { user } = await getCurrentSession();
  if (!user || user.globalRole !== "SYSTEM_ADMIN") return null;
  return user;
}

function forbidden() {
  return Response.json(
    { error: "SYSTEM_ADMIN_REQUIRED", message: "Only a system administrator can manage email." },
    { status: 403 },
  );
}

const pauseBodySchema = z.object({
  eventId: z.string().trim().min(1).max(64),
  paused: z.boolean(),
}).strict();

const senderBodySchema = z.object({ sender: centralSenderInputSchema }).strict();

async function getHandler() {
  const user = await requireSystemAdmin();
  if (!user) return forbidden();
  return Response.json({ events: await listEventEmailStates() });
}

async function patchHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  const user = await requireSystemAdmin();
  if (!user) return forbidden();
  try {
    const body: unknown = await request.json();
    if (typeof body === "object" && body !== null && "sender" in body) {
      const { sender } = senderBodySchema.parse(body);
      return Response.json({ sender: await updateCentralSender(sender, user.id) });
    }
    const input = pauseBodySchema.parse(body);
    await setEventEmailPaused({ eventId: input.eventId, paused: input.paused, actor: user });
    return Response.json({ events: await listEventEmailStates() });
  } catch (error) {
    if (error instanceof EventEmailPauseError) {
      return Response.json(
        { error: error.code, message: error.message },
        { status: error.code === "SYSTEM_ADMIN_REQUIRED" ? 403 : 404 },
      );
    }
    if (error instanceof z.ZodError) {
      return Response.json(
        {
          error: "INVALID_EMAIL_SETTINGS",
          message: error.issues[0]?.message ?? "Review the email settings and try again.",
          issues: error.issues,
        },
        { status: 400 },
      );
    }
    if (error instanceof SyntaxError) {
      return Response.json({ error: "INVALID_JSON", message: "The request is not valid JSON." }, { status: 400 });
    }
    logError("Updating email settings failed", error);
    return Response.json(
      { error: "EMAIL_SETTINGS_UPDATE_FAILED", message: "The email settings could not be saved." },
      { status: 500 },
    );
  }
}

export const GET = withRequestContext(getHandler);
export const PATCH = withRequestContext(patchHandler);
