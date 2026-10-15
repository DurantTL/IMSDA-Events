import { z } from "zod";
import { effectivePermissions, requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { messagingApiError } from "@/modules/communications/api-errors";
import {
  audiencePreviewRequestSchema,
  createAudienceSnapshot,
  getAudienceFilterOptions,
  previewEventAudience,
} from "@/modules/communications/audience-repository";
import { findActiveMembership } from "@/modules/events/repository";
import { withRequestContext } from "@/lib/request-context";

async function authorize(eventId: string) {
  const access = await requirePermission(
    await getCurrentSession(),
    eventId,
    "MANAGE_COMMUNICATIONS",
    findActiveMembership,
  );
  return { access, permissions: effectivePermissions(access.user, access.membership) };
}

const requestSchema = z.discriminatedUnion("mode", [
  audiencePreviewRequestSchema.extend({ mode: z.literal("preview") }),
  z.strictObject({
    mode: z.literal("snapshot"),
    snapshotId: z.uuid(),
    query: z.unknown(),
    previewFingerprint: z.string().trim().length(64),
  }),
]);

/** The filters this staff member may compose. A dimension they may not use is absent, never empty. */
async function getHandler(_request: Request, context: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await context.params;
    const { permissions } = await authorize(eventId);
    return Response.json({ audienceFilters: await getAudienceFilterOptions(eventId, permissions) });
  } catch (error) {
    return messagingApiError(error, "Loading the audience filters");
  }
}

/**
 * Preview only. `mode: "preview"` reads and returns a page of the audience with whole-audience counts and a fingerprint.
 * `mode: "snapshot"` records the reviewed query and fingerprint. Neither sends, queues or schedules anything. It is a POST
 * because the query is the request body and does not belong in a URL or an access log.
 */
async function postHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId } = await context.params;
    const { access, permissions } = await authorize(eventId);
    const body = requestSchema.parse(await request.json());
    if (body.mode === "preview") {
      return Response.json({
        audiencePreview: await previewEventAudience(eventId, permissions, {
          query: body.query,
          view: body.view,
          page: body.page,
        }),
      });
    }
    const snapshot = await createAudienceSnapshot(eventId, access.user.id, permissions, {
      snapshotId: body.snapshotId,
      query: body.query,
      previewFingerprint: body.previewFingerprint,
    });
    return Response.json({ audienceSnapshot: snapshot }, { status: snapshot.replayed ? 200 : 201 });
  } catch (error) {
    return messagingApiError(error, "Previewing the audience");
  }
}

export const GET = withRequestContext(getHandler);
export const POST = withRequestContext(postHandler);
