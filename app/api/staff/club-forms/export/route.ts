import { withRequestContext } from "@/lib/request-context";
import { requireStaffViewer } from "@/modules/club-forms/access";
import { clubFormApiError } from "@/modules/club-forms/api-errors";
import { buildClubFormsCsv } from "@/modules/club-forms/csv";
import { csvDownloadResponse, exportFileName } from "@/modules/reporting/export-response";

/** Conference staff export submitted forms of one template, non-sensitive columns only (#610). */
async function getHandler(request: Request) {
  try {
    const viewer = await requireStaffViewer();
    const params = new URL(request.url).searchParams;
    const templateKey = params.get("form") ?? "";
    const organizationId = params.get("club") ?? undefined;
    const { csv, filename } = await buildClubFormsCsv(viewer, { templateKey, organizationId });
    return csvDownloadResponse(csv, exportFileName({ scope: "club-forms", kind: filename.replace(/\.csv$/, "") }));
  } catch (error) {
    return clubFormApiError(error, "Exporting club forms");
  }
}

export const GET = withRequestContext(getHandler);
