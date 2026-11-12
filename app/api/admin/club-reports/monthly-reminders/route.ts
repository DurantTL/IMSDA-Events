import { z } from "zod";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { clubReportApiError } from "@/modules/club-reports/api-errors";
import { setMonthlyRecordReminderEnabled } from "@/modules/club-reports/monthly-reminders";
import { requireClubsAdministration } from "@/modules/organizations/access";
import { withRequestContext } from "@/lib/request-context";

const schema = z.object({ enabled: z.boolean() }).strict();

/** A Clubs Administrator or system administrator turns the automatic Monthly Record reminder off or back on for the current club year (#1895). Nobody else can. */
async function putHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const actor = await requireClubsAdministration();
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "INVALID_CLUB_REPORT", message: "Send a JSON request body." }, { status: 400 });
    }
    const { enabled } = schema.parse(body);
    return Response.json(await setMonthlyRecordReminderEnabled(enabled, actor.id), { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    return clubReportApiError(error, "Changing the Monthly Record reminder");
  }
}

export const PUT = withRequestContext(putHandler);
