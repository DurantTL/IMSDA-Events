import { requireClubsAdministration } from "@/modules/organizations/access";
import { backgroundCheckApiError } from "@/modules/background-checks/api-errors";
import { lookupBackgroundCheckName } from "@/modules/background-checks/repository";
import { parsePageParam } from "@/lib/pagination";
import { withRequestContext } from "@/lib/request-context";

/**
 * "Why isn't this person matched?" (#598): list rows and roster or
 * registration people with the same or a similar name, and the reason each
 * pair did or didn't match. An empty name lists them all, 25 of each at a time
 * (`rowPage`, `peoplePage`). Read-only and staff-only; never returns a birth
 * date or an email.
 */
async function getHandler(request: Request) {
  try {
    await requireClubsAdministration();
    const params = new URL(request.url).searchParams;
    const name = params.get("name") ?? "";
    // An empty name lists the rows and people, a page of each; page numbers are clamped on the server.
    const lookup = await lookupBackgroundCheckName(name, new Date(), {
      rowPage: parsePageParam(params.get("rowPage")),
      peoplePage: parsePageParam(params.get("peoplePage")),
    });
    return Response.json({ lookup });
  } catch (error) {
    return backgroundCheckApiError(error, "Looking up a Sterling Volunteers name");
  }
}

export const GET = withRequestContext(getHandler);
