import { withRequestContext } from "@/lib/request-context";
import { clubFormApiError } from "@/modules/club-forms/api-errors";
import { isTltFormTemplateKey } from "@/modules/club-forms/domain";
import { buildClubFormsCsv } from "@/modules/club-forms/csv";
import { csvDownloadResponse, exportFileName } from "@/modules/reporting/export-response";
import { currentTltFormsViewer } from "@/modules/tlt-directory/access";

/**
 * One TLT form's submissions as CSV, non-sensitive columns only (#1686): the staff export (`buildClubFormsCsv`), run for
 * the TLT director and for her three forms only. Audited by the export itself. Anyone else gets the same "not found".
 */
async function getHandler(request: Request) {
  const viewer = await currentTltFormsViewer();
  if (!viewer) return Response.json({ message: "Not found." }, { status: 404, headers: { "Cache-Control": "private, no-store" } });
  try {
    const params = new URL(request.url).searchParams;
    // Any form but her three is simply not there for her.
    if (!isTltFormTemplateKey(params.get("form"))) return Response.json({ message: "Not found." }, { status: 404, headers: { "Cache-Control": "private, no-store" } });
    const { csv, filename } = await buildClubFormsCsv(viewer, { templateKey: params.get("form") ?? "", organizationId: params.get("club") ?? undefined });
    return csvDownloadResponse(csv, exportFileName({ scope: "club-forms", kind: filename.replace(/\.csv$/, "") }));
  } catch (error) {
    return clubFormApiError(error, "Exporting TLT forms");
  }
}

export const GET = withRequestContext(getHandler);
