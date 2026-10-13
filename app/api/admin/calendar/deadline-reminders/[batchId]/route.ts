import { after } from "next/server";
import { z } from "zod";
import { logError } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { calendarApiError } from "@/modules/calendar/api-errors";
import { dismissReminderBatch, listPendingReminderBatches, sendReminderBatch } from "@/modules/calendar/deadline-reminders";
import { processAccountEmailQueue } from "@/modules/communications/email-delivery";
import { requireSystemAdministrator } from "@/modules/organizations/access";

type Context = { params: Promise<{ batchId: string }> };

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("send"), fingerprint: z.string().regex(/^[0-9a-f]{64}$/, "Open the reminder again, then send.") }).strict(),
  z.object({ action: z.literal("dismiss") }).strict(),
]);

/**
 * The one human action on a prepared deadline reminder (#910): send it (one
 * click, audited) or choose not to. A system administrator only, same origin
 * only. Sending queues the emails in the outbox; delivery runs after the
 * response and the outbox sweep is the durable fallback.
 */
async function postHandler(request: Request, { params }: Context) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const actor = await requireSystemAdministrator();
    const { batchId } = await params;
    const input = actionSchema.parse(await request.json());
    if (input.action === "dismiss") {
      await dismissReminderBatch(batchId, actor.id);
      return Response.json({ reminders: await listPendingReminderBatches() });
    }
    const result = await sendReminderBatch(batchId, { fingerprint: input.fingerprint }, actor.id);
    after(async () => {
      try {
        await processAccountEmailQueue({ messageIds: result.messageIds, limit: result.messageIds.length });
      } catch (error) {
        logError("Deadline reminders were queued but not delivered after the response.", error, { count: result.messageIds.length });
      }
    });
    return Response.json({ sent: result.sent, optedOut: result.optedOut, reminders: await listPendingReminderBatches() });
  } catch (error) {
    return calendarApiError(error, "Updating a deadline reminder");
  }
}

export const POST = withRequestContext(postHandler);
