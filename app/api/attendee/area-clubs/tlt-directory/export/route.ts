import { withRequestContext } from "@/lib/request-context";
import { clubYearFor } from "@/modules/club-rosters/domain";
import { csvDownloadResponse, exportFileName } from "@/modules/reporting/export-response";
import { exportBodySchema, parseTltFilters } from "@/modules/tlt-directory/domain";
import { tltApiError, tltDirectorRequest } from "@/modules/tlt-directory/api";
import { runTltExport } from "@/modules/tlt-directory/repository";

/** The TLT directory as CSV (#1686), for the filters on screen. POST only because every download is audited. TLT director only. */
async function postHandler(request: Request) {
  const gate = await tltDirectorRequest(request);
  if ("response" in gate) return gate.response;
  try {
    const body = exportBodySchema.parse(gate.body);
    const result = await runTltExport(parseTltFilters(body), gate.actor);
    return csvDownloadResponse(result.csv, exportFileName({ scope: clubYearFor(new Date()), kind: "tlt-directory" }));
  } catch (error) {
    return tltApiError(error, "Exporting the TLT directory");
  }
}

export const POST = withRequestContext(postHandler);
