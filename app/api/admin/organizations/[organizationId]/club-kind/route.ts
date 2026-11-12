import { z } from "zod";
import { withRequestContext } from "@/lib/request-context";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { requireSystemAdministrator } from "@/modules/organizations/access";
import { organizationApiError } from "@/modules/organizations/api-errors";
import { CLUB_KINDS } from "@/modules/organizations/club-kind";
import { setClubKind } from "@/modules/organizations/club-profile-repository";
import { readJsonBody } from "@/modules/organizations/request-body";

const bodySchema = z.object({ clubKind: z.enum(CLUB_KINDS) }).strict();

/** A system administrator sets a club's kind, Pathfinder or Adventurer (#1517). Audited. */
async function patchHandler(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const actor = await requireSystemAdministrator();
    const { organizationId } = await context.params;
    const read = await readJsonBody(request, 1_000);
    if ("response" in read) return read.response;
    const { clubKind } = bodySchema.parse(read.body);
    await setClubKind(organizationId, clubKind, actor.id);
    return Response.json({ clubKind }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return organizationApiError(error, "Changing a club's kind");
  }
}

export const PATCH = withRequestContext(patchHandler);
