import { actorAttribution, requireRosterAccess } from "@/modules/club-rosters/access";
import { clubRegistrationApiError } from "@/modules/club-registrations/api-errors";
import { RegistrationPdfError, readClubRegistrationPdfForDownload } from "@/modules/registration-pdf/repository";
import { withRequestContext } from "@/lib/request-context";

/**
 * The PDF copy of the club's own registration for this event (#1082), for its directors. The same check as editing the
 * registration (a current director, deputy or registrar of this club, fresh on every request), and the registration read
 * is this club's for this event only. `?team=` names the team's key on an event whose clubs register several teams.
 */
const noStore = { "Cache-Control": "private, no-store, max-age=0" };

async function getHandler(request: Request, context: { params: Promise<{ organizationId: string; eventId: string }> }) {
  try {
    const { organizationId, eventId } = await context.params;
    const access = await requireRosterAccess(organizationId, new Date(), "registerForEvents");
    const teamKey = new URL(request.url).searchParams.get("team");
    const pdf = await readClubRegistrationPdfForDownload({ organizationId, eventId, teamKey, actor: actorAttribution(access.actor) });
    return new Response(Buffer.from(pdf.bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${pdf.filename}"`,
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof RegistrationPdfError) {
      return Response.json({ error: error.code, message: error.message }, { status: error.code === "NOT_AVAILABLE" ? 404 : 409, headers: noStore });
    }
    const response = clubRegistrationApiError(error, "Downloading the club registration PDF");
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    return response;
  }
}

export const GET = withRequestContext(getHandler);
