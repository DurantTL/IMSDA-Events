import { after } from "next/server";
import { withRequestContext } from "@/lib/request-context";
import { logError } from "@/lib/logger";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { requireClubLeaderViewer } from "@/modules/club-forms/access";
import { clubFormApiError, readClubFormJson } from "@/modules/club-forms/api-errors";
import { sendOuting } from "@/modules/club-forms/outings";
import { processAccountEmailQueue } from "@/modules/communications/email-delivery";
import { checkClubFormLinkCreateRateLimit } from "@/modules/rate-limit/service";

type RouteContext = { params: Promise<{ organizationId: string; outingId: string }> };

/**
 * Sends an outing's slip to the chosen members' parents (#1672), or sends it again (`resend`). Each family gets its own
 * single-use private link in its own email, through the same link flow as any club form link; the per-recipient rate
 * limit applies to every address. Emails are delivered after the response; the outbox sweep retries a failure.
 */
async function postHandler(request: Request, context: RouteContext) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { organizationId, outingId } = await context.params;
    const viewer = await requireClubLeaderViewer(organizationId);
    const actorKey = viewer.actor.kind === "ATTENDEE" ? viewer.actor.accountId : viewer.actor.userId;
    const { results, messageIds, sent } = await sendOuting(viewer, organizationId, outingId, await readClubFormJson(request), {
      allowRecipient: async (email) => (await checkClubFormLinkCreateRateLimit(request, actorKey, organizationId, email)).allowed,
    });
    if (messageIds.length > 0) {
      after(async () => {
        try {
          await processAccountEmailQueue({ messageIds, limit: messageIds.length });
        } catch (error) {
          logError("Outing permission slip links were queued but not delivered after the response.", error, { count: messageIds.length });
        }
      });
    }
    return Response.json({ sent, results }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    return clubFormApiError(error, "Sending an outing permission slip");
  }
}

export const POST = withRequestContext(postHandler);
