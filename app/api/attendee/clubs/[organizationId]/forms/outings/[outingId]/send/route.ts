import { after } from "next/server";
import { withRequestContext } from "@/lib/request-context";
import { logError } from "@/lib/logger";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { requireClubLeaderViewer } from "@/modules/club-forms/access";
import { clubFormApiError, readClubFormJson } from "@/modules/club-forms/api-errors";
import { sendOuting } from "@/modules/club-forms/outings";
import { processAccountEmailQueue } from "@/modules/communications/email-delivery";
import { applyRateLimitHeaders } from "@/modules/rate-limit/domain";
import { checkClubFormOutingRecipientRateLimit, checkClubFormOutingSendRateLimit } from "@/modules/rate-limit/service";

type RouteContext = { params: Promise<{ organizationId: string; outingId: string }> };

/**
 * Sends an outing's slip to the chosen members' parents (#1672), or sends it again (`resend`). Each family gets its own
 * single-use private link in its own email, through the same link flow as any club form link. The send is rate limited
 * once as an action, and each family once per send by its address (3 an hour for one outing, 12 in all) and, if that passes, the club (400 slips a day), not by the one-at-a-time
 * limits of a typed link. Emails are delivered after the response; the outbox sweep retries a failure.
 */
async function postHandler(request: Request, context: RouteContext) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { organizationId, outingId } = await context.params;
    const viewer = await requireClubLeaderViewer(organizationId);
    const actorKey = viewer.actor.kind === "ATTENDEE" ? viewer.actor.accountId : viewer.actor.userId;
    // One check for the send itself; each family is then charged to its own address and to the club's daily allowance.
    const sendLimit = await checkClubFormOutingSendRateLimit(request, actorKey, organizationId);
    if (!sendLimit.allowed) {
      return applyRateLimitHeaders(
        Response.json({ error: "RATE_LIMITED", message: "You have sent slips too many times this hour or today. Wait a while, then send the rest." }, { status: 429 }),
        sendLimit,
      );
    }
    const { results, messageIds, sent } = await sendOuting(viewer, organizationId, outingId, await readClubFormJson(request), {
      allowRecipient: (email, familySize) => checkClubFormOutingRecipientRateLimit(organizationId, outingId, email, familySize),
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
