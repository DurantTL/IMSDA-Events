import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { getCurrentAttendee } from "@/modules/attendee-accounts/current-attendee";
import { attendeeSignInStep, signInStepRedirectPath } from "@/modules/attendee-accounts/portal-second-step";
import { attendeeSignInRedirectPath } from "@/modules/attendee-accounts/return-redirect";
import type { PortalHelpViewer } from "@/modules/help/portal-visibility";
import { isAreaCoordinator } from "@/modules/organizations/area-coordinators";
import { listDirectedClubs } from "@/modules/organizations/director-access";
import { currentStaffActingContext } from "@/modules/organizations/staff-act-as";

/**
 * The viewer for the portal Help pages (#1259), read the way the account portal layout reads it: the same
 * account, the same sign-in step (#1410), the same director and Area Coordinator checks, and the same staff "act as"
 * context. A visitor with neither an account nor an act-as goes to the sign-in; a club role that has not passed
 * its second step goes to that step. It grants nothing: every portal page checks for itself.
 */
export const loadPortalHelpViewer = cache(async (): Promise<PortalHelpViewer> => {
  const [{ account }, acting] = await Promise.all([getCurrentAttendee(), currentStaffActingContext()]);
  if (!account && !acting) redirect(await attendeeSignInRedirectPath());
  const signInStep = account ? await attendeeSignInStep() : "OK";
  const secondStepPending = signInStep !== "OK";
  if (signInStep !== "OK" && !acting) redirect(await signInStepRedirectPath(signInStep));
  const ownAccount = secondStepPending ? null : account;
  const [clubs, coordinator] = ownAccount
    ? await Promise.all([listDirectedClubs(ownAccount.id), isAreaCoordinator(ownAccount.id)])
    : [[], false];
  return {
    hasAccount: Boolean(ownAccount),
    directedClubs: clubs.map(({ organizationId, role }) => ({ organizationId, role })),
    isAreaCoordinator: coordinator,
    acting: acting?.role === "CLUB_DIRECTOR"
      ? { role: "CLUB_DIRECTOR", organizationId: acting.organizationId ?? null }
      : acting?.role === "AREA_COORDINATOR" ? { role: "AREA_COORDINATOR" } : null,
  };
});
