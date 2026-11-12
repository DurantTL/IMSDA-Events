import { AccessDeniedError } from "@/modules/access/authorization";
import { requireYouthDirectoryAccess } from "@/modules/youth-directory/access";
import { filterYouth, parseYouthQuery, sortYouth, youthCsvRows } from "@/modules/youth-directory/domain";
import { auditYouthDirectoryExport, listYouthDirectoryRows } from "@/modules/youth-directory/repository";
import { toCsv } from "@/modules/reporting/csv";
import { csvDownloadResponse, exportFileName } from "@/modules/reporting/export-response";
import { logError } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";

/**
 * The Youth directory as a CSV file (#1685): the same rows, filters and order as the page, for a system administrator or
 * an active Youth Admin only (checked here on every request). Each export is audited with who, the filters and the row
 * count, never the rows. The columns are the directory's: no birth date, guardian, contact or health detail.
 */
async function getHandler(request: Request) {
  try {
    const viewer = await requireYouthDirectoryAccess();
    const query = parseYouthQuery(Object.fromEntries(new URL(request.url).searchParams));
    const now = new Date();
    const { clubYear, rows } = await listYouthDirectoryRows(now);
    const selected = sortYouth(filterYouth(rows, query.filters), query.sort);
    // Recorded before the file is sent, so an export that was handed over always has its entry.
    await auditYouthDirectoryExport({
      actorUserId: viewer.user.id,
      actorRole: viewer.role === "SYSTEM_ADMIN" ? "SYSTEM_ADMIN" : "YOUTH_ADMINISTRATOR",
      query,
      rowCount: selected.length,
      clubYear,
    });
    return csvDownloadResponse(toCsv(youthCsvRows(selected)), exportFileName({ scope: clubYear, kind: "youth-directory", date: now }));
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      return Response.json({ error: error.code, message: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
    }
    logError("Exporting the Youth directory failed", error);
    return Response.json({ error: "YOUTH_DIRECTORY_EXPORT_FAILED", message: "The export could not be completed." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export const GET = withRequestContext(getHandler);
