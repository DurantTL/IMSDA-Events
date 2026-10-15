import { z } from "zod";
import { withRequestContext } from "@/lib/request-context";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { healthApiError, healthJson, readHealthJson } from "@/modules/health-records/api";
import { listSnapshotHolds, placeSnapshotHold, requireSnapshotAdminViewer } from "@/modules/health-records/snapshot-access-repository";

const bodySchema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("PERSON"), personId: z.string().min(1).max(64), reason: z.string().max(2000) }).strict(),
  z.object({ scope: z.literal("EVENT"), eventId: z.string().min(1).max(64), reason: z.string().max(2000) }).strict(),
]);

/** The legal holds on sealed health copies (#924): ids, reasons, dates and counts. System administrators only. The hold routes work with the health records switch off, so a hold can always be placed before a deletion. */
async function getHandler() {
  try {
    const viewer = await requireSnapshotAdminViewer("LIST_HOLDS", null, { flagOptional: true });
    return healthJson({ holds: await listSnapshotHolds(viewer) });
  } catch (error) {
    return healthApiError(error, "Listing legal holds on sealed health copies");
  }
}

/** Places a legal hold on a person's or an event's sealed copies, with a reason. Audited. */
async function postHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const viewer = await requireSnapshotAdminViewer("PLACE_HOLD", null, { flagOptional: true });
    const body = bodySchema.parse(await readHealthJson(request));
    const target = body.scope === "PERSON" ? { scope: "PERSON" as const, personId: body.personId } : { scope: "EVENT" as const, eventId: body.eventId };
    return healthJson({ ok: true, ...(await placeSnapshotHold(viewer, target, body.reason)) });
  } catch (error) {
    return healthApiError(error, "Placing a legal hold on sealed health copies");
  }
}

export const GET = withRequestContext(getHandler);
export const POST = withRequestContext(postHandler);
