import Link from "next/link";
import { AttendeeSignOutButton } from "@/components/attendee-sign-out-button";
import { BrandMark } from "@/components/brand-mark";
import { getCurrentSession } from "@/modules/access/current-session";
import { accountSignOutMode } from "@/modules/access/workspace-contexts";
import { getCurrentAttendee } from "@/modules/attendee-accounts/current-attendee";
import { listDirectedClubs } from "@/modules/organizations/director-access";
import { clubDirectorRoleLabels, type ClubRole } from "@/modules/organizations/director-grants-domain";
import { currentStaffActingContext } from "@/modules/organizations/staff-act-as";

/**
 * The compact "Club portal" masthead (#1165): the IMSDA mark, who is signed
 * in, My account and Sign out. It carries no staff or system links: ordinary
 * club work stays free of platform administration. My account goes to
 * /account on purpose; it is not a role picker. When this person directs more
 * than one club, "Switch club" opens their existing list of clubs, which only
 * lists clubs they hold a current grant for.
 */
export async function ClubPortalMasthead({ role }: { role: ClubRole }) {
  const [{ account, via }, staffSession, acting] = await Promise.all([getCurrentAttendee(), getCurrentSession(), currentStaffActingContext()]);
  const clubs = account && via === "attendee" ? await listDirectedClubs(account.id) : [];
  const signOut = accountSignOutMode({ hasAttendeeAccount: Boolean(account), hasStaffSession: Boolean(staffSession.user), actingAsClubRole: Boolean(acting) });

  return (
    <header className="club-masthead">
      <div className="club-masthead-inner">
        <Link className="club-masthead-brand" href="/account">
          <BrandMark />
          <span><small>IMSDA Events</small><strong>Club portal</strong></span>
        </Link>
        <div className="club-masthead-account">
          {account && (
            <span className="club-masthead-identity" translate="no">
              <span className="club-masthead-name">{account.displayName}</span>
              <span className="club-masthead-role"> · {clubDirectorRoleLabels[role]}</span>
            </span>
          )}
          {clubs.length > 1 && <Link className="text-button club-masthead-link" href="/account/clubs">Switch club</Link>}
          {account && <Link className="text-button club-masthead-link" href="/account">My account</Link>}
          {signOut !== "none" && <AttendeeSignOutButton className="text-button club-masthead-link" endStaffSession={signOut === "both"} />}
        </div>
      </div>
    </header>
  );
}
