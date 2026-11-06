import type { ReactNode } from "react";
import { AccountWorkspaceMenu } from "@/components/account-workspace-menu";
import { AttendeeSignOutButton } from "@/components/attendee-sign-out-button";
import { FormsHelp } from "@/components/forms-help";
import styles from "@/components/club-portal-masthead-view.module.css";
import type { AccountSignOutMode } from "@/modules/access/workspace-contexts";
import type { FormsHelpContact } from "@/modules/system-admin/forms-help-contact";

/**
 * The right side of the club and coordinator mastheads (#1555): who is signed in, then the same outlined buttons in both
 * portals: the "Your account" drop-down (it replaces a separate My account button), Forms help and Sign out. `leading`
 * is for what only one portal has, such as the club's Switch club.
 */
export function PortalMastheadActions({ identity, leading, formsHelpContact, signOut, accountMenu = true }: {
  identity: ReactNode;
  leading?: ReactNode;
  formsHelpContact?: FormsHelpContact;
  signOut: AccountSignOutMode;
  /** The "Your account" drop-down. Off on the attendee account, whose tab row lists the same destinations. */
  accountMenu?: boolean;
}) {
  return (
    <div className={styles.account}>
      {identity}
      {leading}
      {accountMenu && <AccountWorkspaceMenu />}
      {formsHelpContact && <FormsHelp className={styles.action} contact={formsHelpContact} />}
      {signOut !== "none" && <AttendeeSignOutButton className={styles.action} endStaffSession={signOut === "both"} />}
    </div>
  );
}
