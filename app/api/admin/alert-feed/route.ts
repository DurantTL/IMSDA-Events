import { z } from "zod";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { logError } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";
import { listAlertFeed, markAlertFeedItemRead, markAllAlertFeedRead } from "@/modules/notifications/feed";

/**
 * The system administrator alert feed (#1033, slice 2 of the notification bell). Read and unread are per administrator
 * and the items span every event, so every request is gated on the global role, checked here on the server again each
 * time (the bell is only rendered for system administrators, but hiding it is not the control). Responses are
 * `private, no-store`: the unread state is one person's.
 */
const NO_STORE = { "Cache-Control": "private, no-store" };

async function requireSystemAdmin() {
  const { user } = await getCurrentSession();
  return user && user.globalRole === "SYSTEM_ADMIN" ? user : null;
}

function forbidden() {
  return Response.json(
    { error: "SYSTEM_ADMIN_REQUIRED", message: "Only a system administrator can see this." },
    { status: 403, headers: { "Cache-Control": "no-store" } },
  );
}

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("read"), id: z.string().min(1).max(64) }).strict(),
  /** `cutoff` is the time of the newest item the person was shown; without it the server's clock at the press is used. */
  z.object({ action: z.literal("read-all"), cutoff: z.string().datetime().optional() }).strict(),
]);

async function getHandler() {
  const user = await requireSystemAdmin();
  if (!user) return forbidden();
  try {
    return Response.json({ feed: await listAlertFeed(user.id) }, { headers: NO_STORE });
  } catch (error) {
    logError("Loading the admin alert feed failed", error);
    return Response.json(
      { error: "ALERT_FEED_UNAVAILABLE", message: "Alerts could not be loaded." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

async function postHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  const user = await requireSystemAdmin();
  if (!user) return forbidden();
  try {
    const body = bodySchema.parse(await request.json());
    // One clock for the whole request: the cutoff is captured here, before anything is read.
    const now = new Date();
    if (body.action === "read") {
      const found = await markAlertFeedItemRead(user.id, body.id, now);
      if (!found) {
        return Response.json(
          { error: "ALERT_UNAVAILABLE", message: "That alert is no longer available." },
          { status: 404, headers: NO_STORE },
        );
      }
    } else {
      await markAllAlertFeedRead(user.id, body.cutoff ? new Date(body.cutoff) : now, now);
    }
    return Response.json({ feed: await listAlertFeed(user.id, now) }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return Response.json(
        { error: "INVALID_REQUEST", message: "The request is not valid." },
        { status: 400, headers: NO_STORE },
      );
    }
    logError("Updating the admin alert feed failed", error);
    return Response.json(
      { error: "ALERT_FEED_UPDATE_FAILED", message: "The alerts could not be updated." },
      { status: 500, headers: NO_STORE },
    );
  }
}

export const GET = withRequestContext(getHandler);
export const POST = withRequestContext(postHandler);
