import { z } from "zod";
import { requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { findActiveMembership } from "@/modules/events/repository";
import { MAX_IMPORT_CHARACTERS, STAFF_INVITATION_GROUPS } from "@/modules/staff-invitations/domain";
import { staffInvitationApiError } from "@/modules/staff-invitations/api-errors";
import { confirmInvitationImport, previewInvitationImport } from "@/modules/staff-invitations/repository";
import { withRequestContext } from "@/lib/request-context";

type Context = { params: Promise<{ eventId: string }> };

const noStore = { "Cache-Control": "no-store" };

const bodySchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("preview"),
    csv: z.string().max(MAX_IMPORT_CHARACTERS),
    defaultGroup: z.enum(STAFF_INVITATION_GROUPS).nullable().default(null),
  }).strict(),
  z.object({
    mode: z.literal("confirm"),
    csv: z.string().max(MAX_IMPORT_CHARACTERS),
    defaultGroup: z.enum(STAFF_INVITATION_GROUPS).nullable().default(null),
    /** The preview's digest: confirming creates only what that preview showed. */
    digest: z.string().regex(/^[0-9a-f]{32}$/),
  }).strict(),
]);

/**
 * The CSV import (#804). `preview` reads the file and reports every row without creating anything; `confirm` creates the
 * invitations the preview showed as new. Neither sends an email.
 */
async function postHandler(request: Request, context: Context) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId } = await context.params;
    const access = await requirePermission(await getCurrentSession(), eventId, "MANAGE_REGISTRATION", findActiveMembership);
    const body = bodySchema.parse(await request.json());
    if (body.mode === "preview") {
      return Response.json({ preview: await previewInvitationImport(eventId, { csv: body.csv, defaultGroup: body.defaultGroup }) }, { headers: noStore });
    }
    return Response.json({ result: await confirmInvitationImport(eventId, access.user.id, { csv: body.csv, defaultGroup: body.defaultGroup, digest: body.digest }) }, { status: 201, headers: noStore });
  } catch (error) {
    return staffInvitationApiError(error, "Importing the invitations");
  }
}

export const POST = withRequestContext(postHandler);
