import "server-only";

import { getCurrentAttendee } from "@/modules/attendee-accounts/current-attendee";
import { attendeeSecondStepPending } from "@/modules/attendee-accounts/portal-second-step";
import { listDirectedClubs } from "@/modules/organizations/director-access";
import { currentStaffActingContext } from "@/modules/organizations/staff-act-as";

/**
 * The clubs the signed-in coordinator also directs (#1551): they open normally from Clubs at a glance, every other
 * club opens view only. Staff acting as a coordinator direct nothing, and a session still waiting on its club second
 * step is left out, as on the My club pages. This only picks which link a row shows; the club pages check access.
 */
export async function currentOwnDirectedClubIds(): Promise<string[]> {
  if (await currentStaffActingContext()) return [];
  const { account } = await getCurrentAttendee();
  if (!account || (await attendeeSecondStepPending())) return [];
  return (await listDirectedClubs(account.id)).map((club) => club.organizationId);
}
