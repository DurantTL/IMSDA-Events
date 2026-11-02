import { requireRosterAccess } from "@/modules/club-rosters/access";
import { rosterApiError } from "@/modules/club-rosters/api-errors";
import { buildClubSchedule, clubScheduleCsv } from "@/modules/honors/roster-domain";
import { getHonorRosterData } from "@/modules/honors/roster-repository";
import { withRequestContext } from "@/lib/request-context";
import { csvDownloadResponse, exportFileName } from "@/modules/reporting/export-response";

type Context = { params: Promise<{ organizationId: string; eventId: string }> };

/** A director's own club schedule as CSV (#360). Ages only; never other clubs. */
async function getHandler(_request: Request, { params }: Context) {
  try {
    const { organizationId, eventId } = await params;
    await requireRosterAccess(organizationId);
    const data = await getHonorRosterData(eventId, { includeDietary: false, organizationId });
    if (!data || !data.clubs.some((club) => club.id === organizationId)) {
      return Response.json({ error: "NOT_REGISTERED", message: "Your club isn't registered for this event." }, { status: 404 });
    }
    const csv = clubScheduleCsv(buildClubSchedule(organizationId, data.sessions, data.offerings, data.enrollments, data.attendees, data.locations), data.hasLocations);
    return csvDownloadResponse(csv, exportFileName({ scope: organizationId, kind: "class-schedule" }));
  } catch (error) {
    return rosterApiError(error, "Downloading the club schedule");
  }
}

export const GET = withRequestContext(getHandler);
