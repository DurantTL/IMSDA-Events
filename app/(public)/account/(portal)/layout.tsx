import { AccountContent } from "@/components/account-content";
import { AccountWorkspaceMenu } from "@/components/account-workspace-menu";
import { redirect } from "next/navigation";
import { AccountHeaderActions } from "@/components/account-header-actions";
import { AccountAnnouncementBanner } from "@/components/account-announcement-banner";
import { AccountSectionNav, type AccountNavItem } from "@/components/account-section-nav";
import { ActAsBanner } from "@/components/act-as-banner";
import { AttendeeAuthReturn } from "@/components/attendee-sign-in-form";
import { BrandLink } from "@/components/brand-link";
import { getCurrentSession } from "@/modules/access/current-session";
import { accountSignOutMode, otherWorkspaceContextsForAttendee } from "@/modules/access/workspace-contexts";
import { listAccountBannerAnnouncements } from "@/modules/communications/account-banner";
import { getCurrentAttendee } from "@/modules/attendee-accounts/current-attendee";
import { signInStepRedirectPath } from "@/modules/attendee-accounts/portal-second-step";
import { attendeeSignInRedirectPath } from "@/modules/attendee-accounts/return-redirect";
import { accountNeedsSignInStep } from "@/modules/attendee-accounts/sign-in-gate";
import { isAreaCoordinator } from "@/modules/organizations/area-coordinators";
import { listDirectedClubs } from "@/modules/organizations/director-access";
import { currentStaffActingContext } from "@/modules/organizations/staff-act-as";

/**
 * The signed-in attendee area: one header and one row of tabs, with each
 * job (registrations, clubs, profile, sign-in security) on its own page.
 * Every page still checks the session itself; this layout is only chrome,
 * except that it sends a session that owes the sign-in step (#1410) on: the
 * emailed code for a club role without two-step sign-in, or the authenticator
 * or passkey it already has. Club pages ask for a real second step themselves.
 *
 * A staff member "acting as" a club role (#442) reaches this portal with no
 * attendee account at all — the accounts stay separate. Chrome that assumes
 * one (registrations, profile, security, the attendee sign-out button) is
 * left out for them; the banner and "Clubs"/"Area" tabs come from the
 * act-as record instead.
 */
export default async function AccountPortalLayout({ children }: { children: React.ReactNode }) {
  const [{ account, via, sessionId }, staffSession, acting] = await Promise.all([
    getCurrentAttendee(),
    getCurrentSession(),
    currentStaffActingContext(),
  ]);
  if (!account && !acting) redirect(await attendeeSignInRedirectPath());
  // A club role without two-step sign-in enters its emailed code first; one with it confirms it (staff viewing an
  // account use their own). Their own pages open after that; club pages ask for a real second step themselves (#1410).
  const signInStep = account && via === "attendee" ? await accountNeedsSignInStep(account.id, sessionId) : "OK";
  const signInStepPending = signInStep !== "OK";
  // While a staff "act as" is active (#442), act-as pages resolve purely from
  // the staff session: an unrelated attendee cookie on this browser that
  // hasn't finished its sign-in step doesn't send them to /account/two-step.
  // Its account chrome is left out instead, and each page that shows the
  // attendee account checks the sign-in step itself.
  if (signInStep !== "OK" && !acting) redirect(await signInStepRedirectPath(signInStep));
  const chromeAccount = signInStepPending ? null : account;
  // The one other workspace this attendee identity may switch into (#108):
  // the staff workspace, only when this browser also carries a live staff
  // session — the same decision `app-shell.tsx` makes in the other direction.
  // A system administrator's staff session also offers System management (#1009).
  const workspaceContexts = otherWorkspaceContextsForAttendee({
    hasStaffSession: Boolean(staffSession.user),
    isSystemAdmin: staffSession.user?.globalRole === "SYSTEM_ADMIN",
  });
  // Banner announcements are account-session only: a staff "act as" with no
  // attendee account (or a second step still pending) gets none. The banner
  // query starts as soon as the clubs load, alongside the coordinator check.
  const clubsPromise = chromeAccount ? listDirectedClubs(chromeAccount.id) : Promise.resolve([]);
  const [clubs, areaCoordinator, bannerAnnouncements] = chromeAccount
    ? await Promise.all([
      clubsPromise,
      isAreaCoordinator(chromeAccount.id),
      clubsPromise.then((directed) => listAccountBannerAnnouncements(chromeAccount, directed)),
    ])
    : [[], false, []];

  const actingAsAreaCoordinator = acting?.role === "AREA_COORDINATOR";
  const actingAsDirector = acting?.role === "CLUB_DIRECTOR";

  // The attendee's own tabs come first and in the same order for everyone (#1175); a workspace tab follows only
  // when the existing grant (director, Area Coordinator) is real, so an ordinary attendee sees just these three.
  const items: AccountNavItem[] = [
    ...(chromeAccount
      ? [
        { href: "/account", label: "Overview" },
        { href: "/account/registrations", label: "My registrations" },
        { href: "/account/profile", label: "Profile" },
      ]
      : []),
    // Area Coordinators see every club (#387), so the tab is just "Clubs".
    ...(areaCoordinator || actingAsAreaCoordinator
      ? [{ href: "/account/clubs", label: "Clubs", matchChildren: true, alsoMatchPrefix: "/account/area/" }]
      : clubs.length > 0 || actingAsDirector
        ? [{ href: "/account/clubs", label: clubs.length === 1 || actingAsDirector ? "My club" : "My clubs", matchChildren: true }]
        : []),
    ...(areaCoordinator || actingAsAreaCoordinator
      ? [{ href: "/account/area-clubs/overview", label: "Club coordination", alsoMatchPrefix: "/account/area-clubs/" }]
      : []),
    // An Area Coordinator sees the clubs waitlisted at the locations they coordinate (#599).
    ...(areaCoordinator ? [{ href: "/account/waitlists", label: "Waitlists" }] : []),
    // Portal help (#1259): last, for anyone using the portal. Which guides it lists is decided on its own pages.
    { href: "/account/help", label: "Help", matchChildren: true },
  ];
  // A separate attendee cookie must not add personal or coordinator destinations to a director act-as menu.
  const workspaceMenuItems = acting
    ? items.filter((item) => item.href === "/account/clubs" || item.href === "/account/help"
      || (actingAsAreaCoordinator && item.href === "/account/area-clubs/overview"))
    : items;

  return (
    <main className="public-registration-page public-manage-page account-portal">
      <AttendeeAuthReturn />
      <header className="public-registration-header">
        <div className="public-registration-header-inner">
          <BrandLink className="public-registration-brand public-event-brand-link" wordmark />
          <AccountHeaderActions
            identity={acting ? undefined : chromeAccount?.displayName}
            contexts={workspaceContexts}
            signOut={accountSignOutMode({ hasAttendeeAccount: Boolean(account), hasStaffSession: Boolean(staffSession.user), actingAsClubRole: Boolean(acting) })}
          />
        </div>
      </header>
      <ActAsBanner acting={acting} inAccount />
      <AccountSectionNav items={items} label="Your account" />
      {chromeAccount && <AccountAnnouncementBanner accountId={chromeAccount.id} announcements={bannerAnnouncements} />}
      <AccountWorkspaceMenu items={workspaceMenuItems} />
      <AccountContent>{children}</AccountContent>
    </main>
  );
}
