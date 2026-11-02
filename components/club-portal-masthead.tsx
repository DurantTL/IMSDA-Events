import { clubMastheadModel, ClubPortalMastheadView } from "@/components/club-portal-masthead-view";
import { getCurrentSession } from "@/modules/access/current-session";
import { accountSignOutMode } from "@/modules/access/workspace-contexts";
import { getCurrentAttendee } from "@/modules/attendee-accounts/current-attendee";
import { accountNeedsSecondStep } from "@/modules/attendee-accounts/sign-in-gate";
import { getFormsHelpContact } from "@/modules/system-admin/platform-settings";
import { listDirectedClubs } from "@/modules/organizations/director-access";
import type { ClubRole } from "@/modules/organizations/director-grants-domain";
import { currentStaffActingContext } from "@/modules/organizations/staff-act-as";

/**
 * The compact "Club portal" masthead (#1165). It resolves the signed-in
 * identity the way the account portal layout does: during a staff act-as, or
 * while this session's second step is pending, no attendee identity, My
 * account or Switch club is shown (#442). "Switch club" opens the person's
 * existing list of clubs, which only lists clubs they hold a current grant for.
 * `actingAs` is the club access actor's own answer; the act-as context is a
 * second signal for the same thing.
 */
export async function ClubPortalMasthead({ role, actingAs }: { role: ClubRole; actingAs: boolean }) {
  const [{ account, via, sessionId }, staffSession, acting] = await Promise.all([getCurrentAttendee(), getCurrentSession(), currentStaffActingContext()]);
  const isActing = actingAs || Boolean(acting);
  const secondStepPending = Boolean(account && via === "attendee" && (await accountNeedsSecondStep(account.id, sessionId)) !== "OK");
  const clubs = account && !isActing && !secondStepPending && via === "attendee" ? await listDirectedClubs(account.id) : [];
  const model = clubMastheadModel({
    account,
    secondStepPending,
    actingAs: isActing,
    clubCount: clubs.length,
    signOut: accountSignOutMode({ hasAttendeeAccount: Boolean(account), hasStaffSession: Boolean(staffSession.user), actingAsClubRole: isActing }),
  });
  return <ClubPortalMastheadView model={model} role={role} formsHelpContact={await getFormsHelpContact()} />;
}
