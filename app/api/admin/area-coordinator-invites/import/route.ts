import { z } from "zod";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { requireSystemAdministrator } from "@/modules/organizations/access";
import { confirmAreaCoordinatorImport, previewAreaCoordinatorImport } from "@/modules/organizations/area-coordinator-import";
import { AreaCoordinatorCsvError, MAX_AREA_COORDINATOR_CSV_BYTES } from "@/modules/organizations/area-coordinator-import-domain";
import { userAdminApiError } from "@/modules/system-admin/user-admin-api";
import { withRequestContext } from "@/lib/request-context";

const importSchema = z.object({
  csv: z.string().max(MAX_AREA_COORDINATOR_CSV_BYTES, "That file is too large. Upload up to 500 people at a time."),
  confirm: z.boolean().default(false),
}).strict();

/**
 * Area Coordinator CSV upload (#1608), system administrators only. Without `confirm` it only previews; with it, each Add
 * row becomes a PENDING invite. Nothing is emailed here: the Send button does that.
 */
async function postHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const actor = await requireSystemAdministrator("System administrator access is required to import Area Coordinators.");
    const { csv, confirm } = importSchema.parse(await request.json());
    if (!confirm) return Response.json(await previewAreaCoordinatorImport(csv), { headers: { "Cache-Control": "no-store" } });
    const { steps, added } = await confirmAreaCoordinatorImport(csv, actor.id);
    return Response.json({ steps, added }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AreaCoordinatorCsvError) {
      return Response.json({ error: "INVALID_AREA_COORDINATOR_CSV", message: error.message }, { status: 400 });
    }
    return userAdminApiError(error, "Importing Area Coordinators");
  }
}

export const POST = withRequestContext(postHandler);
