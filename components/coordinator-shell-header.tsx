import { AreaClubsSubNav, coordinatorNavItems } from "@/components/area-clubs-subnav";
import { CoordinatorMastheadView, coordinatorMastheadModel } from "@/components/coordinator-masthead-view";
import { getCurrentSession } from "@/modules/access/current-session";
import { accountSignOutMode } from "@/modules/access/workspace-contexts";
import { getCurrentAttendee } from "@/modules/attendee-accounts/current-attendee";
import { accountNeedsSecondStep } from "@/modules/attendee-accounts/sign-in-gate";
import { isAreaCoordinator } from "@/modules/organizations/area-coordinators";
import { currentStaffActingContext } from "@/modules/organizations/staff-act-as";

/**
 * The coordinator workspace's top: the "Club coordination" masthead and the
 * task navigation (#1186). It resolves identity from the same signals the portal
 * layout uses: during a staff act-as, or while this session's second step is
 * pending, no attendee identity, My account or Waitlists is shown. It is chrome
 * only; every page and route handler under it checks the coordinator grant
 * itself, and nothing here grants or hides authority. `children` (a page hero)
 * sits between the masthead and the navigation. The wrapper class lets
 * globals.css retire the account header and tabs on these pages, as the club
 * shell does.
 */
export async function CoordinatorShellHeader({ children }: { children?: React.ReactNode } = {}) {
  const [{ account, via, sessionId }, staffSession, acting] = await Promise.all([getCurrentAttendee(), getCurrentSession(), currentStaffActingContext()]);
  const actingAs = Boolean(acting);
  const secondStepPending = Boolean(account && via === "attendee" && (await accountNeedsSecondStep(account.id, sessionId)) !== "OK");
  const isCoordinator = Boolean(account && via === "attendee" && !actingAs && !secondStepPending && (await isAreaCoordinator(account.id)));
  const model = coordinatorMastheadModel({
    account,
    secondStepPending,
    actingAs,
    isCoordinator,
    signOut: accountSignOutMode({ hasAttendeeAccount: Boolean(account), hasStaffSession: Boolean(staffSession.user), actingAsClubRole: Boolean(acting) }),
  });
  return (
    <div className="coordinator-shell">
      <CoordinatorMastheadView model={model} />
      {children}
      <AreaClubsSubNav items={coordinatorNavItems({ showWaitlists: model.showWaitlists })} />
    </div>
  );
}
