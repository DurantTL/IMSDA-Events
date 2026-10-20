import Link from "next/link";
import { KeyRound, LayoutDashboard, LogIn, UserRound } from "lucide-react";

// Kept here (not imported from the server-only module) so this stays presentational.
// `/select-event` is the role-aware staff landing: a system administrator goes on to /admin,
// no events to /no-access, one event to its workspace, several to the picker. A `next` is
// needed so /sign-in does not send an attendee session on to /account.
export const STAFF_SIGN_IN_HREF = "/sign-in?next=%2Fselect-event";
export const PUBLIC_SIGN_IN_UNIFIED_HREF = "/sign-in";
export const PUBLIC_SIGN_IN_ATTENDEE_HREF = "/account/sign-in";

/**
 * The session links in the public site header (#1009). Presentational only:
 * `PublicHeaderSessionLinks` reads the sessions and the single sign-in switch.
 * Nobody signed in: "Sign in" (to `/sign-in` with single sign-in on, else
 * `/account/sign-in`; staff keep `/login`, which is not linked here). A staff
 * session: "Staff workspace". An attendee session: "My account". These are
 * links only; `/overview` and `/account` check access themselves.
 */
export function PublicHeaderLinks({
  staffSignedIn,
  attendeeSignedIn,
  unifiedSignInEnabled,
  staffTimedOut = false,
}: {
  staffSignedIn: boolean;
  attendeeSignedIn: boolean;
  unifiedSignInEnabled: boolean;
  /** (#1092) Signed in as an attendee linked to a staff user whose staff side timed out: shows "Staff sign-in". */
  staffTimedOut?: boolean;
}) {
  if (!staffSignedIn && !attendeeSignedIn) {
    return (
      <Link className="text-button" href={unifiedSignInEnabled ? PUBLIC_SIGN_IN_UNIFIED_HREF : PUBLIC_SIGN_IN_ATTENDEE_HREF}>
        <LogIn size={16} aria-hidden="true" /> <span>Sign in</span>
      </Link>
    );
  }
  return (
    <>
      {staffSignedIn && (
        <Link className="text-button" href="/overview">
          <LayoutDashboard size={16} aria-hidden="true" /> <span>Staff workspace</span>
        </Link>
      )}
      {attendeeSignedIn && (
        <Link className="text-button" href="/account">
          <UserRound size={16} aria-hidden="true" /> <span>My account</span>
        </Link>
      )}
      {!staffSignedIn && attendeeSignedIn && staffTimedOut && (
        <Link className="text-button" href={STAFF_SIGN_IN_HREF}>
          <KeyRound size={16} aria-hidden="true" /> <span>Staff sign-in</span>
        </Link>
      )}
    </>
  );
}
