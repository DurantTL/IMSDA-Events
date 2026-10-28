import "server-only";

import { after } from "next/server";
import { logError } from "@/lib/logger";
import { processAccountEmailQueue } from "@/modules/communications/email-delivery";

/**
 * Delivers queued invite emails after the response, the way the club invite Send route does. The messages are already
 * in the outbox, so a failure here only delays them: the scheduled sweep is the durable fallback.
 */
export function deliverQueuedInviteEmailsAfterResponse(messageIds: readonly string[]) {
  if (messageIds.length === 0) return;
  after(async () => {
    try {
      await processAccountEmailQueue({ messageIds: [...messageIds], limit: messageIds.length });
    } catch (error) {
      logError("Invite emails were queued but not delivered after the response.", error, { count: messageIds.length });
    }
  });
}
