import Link from "next/link";
import { LayoutDashboard, LogIn, UserRound } from "lucide-react";

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
}: {
  staffSignedIn: boolean;
  attendeeSignedIn: boolean;
  unifiedSignInEnabled: boolean;
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
    </>
  );
}
