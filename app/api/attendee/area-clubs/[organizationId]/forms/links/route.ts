import { after } from "next/server";
import { z } from "zod";
import { withRequestContext } from "@/lib/request-context";
import { logError } from "@/lib/logger";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { requireAreaCoordinatorViewer } from "@/modules/club-forms/access";
import { clubFormApiError, readClubFormJson } from "@/modules/club-forms/api-errors";
import { createClubFormLink } from "@/modules/club-forms/links";
import { createLinkSchema } from "@/modules/club-forms/schemas";
import { processAccountEmailQueue } from "@/modules/communications/email-delivery";
import { applyRateLimitHeaders } from "@/modules/rate-limit/domain";
import { checkClubFormLinkCreateRateLimit } from "@/modules/rate-limit/service";

// No roster member for a coordinator: absent or null is fine, anything else is refused.
const areaLinkSchema = createLinkSchema.extend({ rosterMemberId: z.null().optional() });

type RouteContext = { params: Promise<{ organizationId: string }> };

const privateHeaders = { "Cache-Control": "private, no-store, max-age=0" };

/**
 * An Area Coordinator sends a single-use private link for any club (#1221), for example to help a director with the
 * TLT forms. Same rules as the director's route: rate limit, expiry, and one email queued in the link's own
 * transaction. The link belongs to the club, so the form lands in that club's records. The roster is not offered:
 * a non-null `rosterMemberId` is refused here so a coordinator never learns a club's roster. Which clubs a coordinator may send
 * for is decided in one place (`viewerCanSendLinkForClub`, #843).
 */
async function postHandler(request: Request, context: RouteContext) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { organizationId } = await context.params;
    const viewer = await requireAreaCoordinatorViewer();
    const input = areaLinkSchema.parse(await readClubFormJson(request));
    const actorKey = viewer.actor.kind === "ATTENDEE" ? viewer.actor.accountId : viewer.actor.userId;
    const rateLimit = await checkClubFormLinkCreateRateLimit(request, actorKey, organizationId, input.recipientEmail);
    if (!rateLimit.allowed) {
      return applyRateLimitHeaders(
        Response.json({ error: "RATE_LIMITED", message: "Too many links sent. Try again later." }, { status: 429 }),
        rateLimit,
      );
    }
    const { linkId, messageId, expiresAt } = await createClubFormLink(viewer, { ...input, rosterMemberId: null, organizationId });
    after(async () => {
      try {
        await processAccountEmailQueue({ messageIds: [messageId], limit: 1 });
      } catch (error) {
        logError("A club form link was queued but not delivered after the response.", error, { messageId });
      }
    });
    return Response.json({ link: { id: linkId, expiresAt: expiresAt.toISOString() } }, { status: 201, headers: privateHeaders });
  } catch (error) {
    return clubFormApiError(error, "Sending a club form link");
  }
}

export const POST = withRequestContext(postHandler);
