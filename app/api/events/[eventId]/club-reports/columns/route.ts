import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { findActiveMembership } from "@/modules/events/repository";
import { canViewDietaryDetails } from "@/modules/registrations/attendee-listing";
import { requireClubReportsAccess } from "@/modules/reporting/club-reports-access";
import { clubReportApiError, handleClubReportRequest } from "@/modules/reporting/club-report-api";
import { withRequestContext } from "@/lib/request-context";

/**
 * The staff club report column chooser (#1671): preview, print, CSV and saved layouts for one club event. Same access as
 * the other club reports. Staff are not limited to one location today, so any of the event's locations may be chosen
 * (`resolveLocation` is where such a limit would go). Dietary text also needs the sensitive-data permissions (`canViewDietaryDetails`); a column
 * the person may not see is refused, never blanked.
 */
async function postHandler(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  try {
    const { eventId } = await context.params;
    const session = await getCurrentSession();
    const access = await requireClubReportsAccess(session, eventId, findActiveMembership);
    return await handleClubReportRequest({
      eventId,
      viewer: { kind: "staff", canViewDietaryDetails: canViewDietaryDetails({ permissions: access.permissions, clubEvent: true }) },
      actor: { kind: "staff", userId: access.user.id },
      body: await request.json(),
      // Pathfinder event-manager oversight is view only: it may run a report but not change shared layouts.
      canManageLayouts: access.permissions.includes("VIEW_REPORTS"),
    });
  } catch (error) {
    return clubReportApiError(error, "Building the club report");
  }
}

export const POST = withRequestContext(postHandler);
