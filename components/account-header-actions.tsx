import { NavigationLink as Link } from "@/components/navigation-link";
import { KeyRound, LayoutDashboard, ShieldCheck } from "lucide-react";
import { PortalMastheadActions } from "@/components/portal-masthead-actions";
import { STAFF_SIGN_IN_HREF } from "@/components/public-header-links";
import styles from "@/components/club-portal-masthead-view.module.css";
import type { AccountSignOutMode, WorkspaceContext } from "@/modules/access/workspace-contexts";

/**
 * The right side of the My account header (#1009, #1555): the staff and system buttons a browser with a live staff
 * session may use (`otherWorkspaceContextsForAttendee` decides which), next to Sign out (`accountSignOutMode` decides
 * what it ends), as the club masthead's outlined buttons. No "Your account" drop-down here: the tab row under this
 * header already lists the same destinations. Links only; `/overview` and `/admin` check access themselves.
 */
export function AccountHeaderActions({
  contexts,
  signOut,
  identity,
  staffSignInEnded = false,
}: {
  contexts: WorkspaceContext[];
  signOut: AccountSignOutMode;
  /** The signed-in person's display name (#1175); left out for a staff "act as" session with no attendee account. */
  identity?: string;
  /** A person linked to a staff account whose staff sign-in has ended (#1947): shows "Staff sign-in" in place of "Staff workspace". */
  staffSignInEnded?: boolean;
}) {
  return (
    <PortalMastheadActions
      accountMenu={false}
      signOut={signOut}
      identity={identity && <span className="club-masthead-identity" translate="no">{identity}</span>}
      leading={<>
        {staffSignInEnded && (
          <Link aria-label="Staff sign-in" className={styles.action} href={STAFF_SIGN_IN_HREF}>
            <KeyRound size={16} aria-hidden="true" />
            <span className={styles.label}>Staff sign-in</span>
          </Link>
        )}
        {contexts.map((context) => (
        <Link aria-label={context.label} className={styles.action} href={context.href} key={context.kind}>
          {context.kind === "system_admin"
            ? <ShieldCheck size={16} aria-hidden="true" />
            : <LayoutDashboard size={16} aria-hidden="true" />}
          <span className={styles.label}>{context.label}</span>
        </Link>
        ))}
      </>}
    />
  );
}
