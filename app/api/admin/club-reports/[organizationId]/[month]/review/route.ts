import { z } from "zod";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { clubReportApiError } from "@/modules/club-reports/api-errors";
import { isReportMonth } from "@/modules/club-reports/domain";
import { setClubReportReviewed } from "@/modules/club-reports/review";
import { requireClubsAdministration } from "@/modules/organizations/access";
import { withRequestContext } from "@/lib/request-context";

const reviewSchema = z.object({ reviewed: z.boolean() }).strict();

/** A Clubs Administrator or system administrator marks a submitted monthly record Reviewed, or undoes it (#1246). Nobody else can. */
async function putHandler(request: Request, context: { params: Promise<{ organizationId: string; month: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const actor = await requireClubsAdministration();
    const { organizationId, month } = await context.params;
    if (!isReportMonth(month)) return Response.json({ error: "CLUB_REPORT_MONTH_INVALID", message: "That month isn't valid." }, { status: 400 });
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "INVALID_CLUB_REPORT", message: "Send a JSON request body." }, { status: 400 });
    }
    const { reviewed } = reviewSchema.parse(body);
    return Response.json(await setClubReportReviewed(organizationId, month, reviewed, actor.id), { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    return clubReportApiError(error, "Marking a Monthly Record reviewed");
  }
}

export const PUT = withRequestContext(putHandler);
