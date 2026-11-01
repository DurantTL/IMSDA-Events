import { NavigationLink as Link } from "@/components/navigation-link";
import { AttendeeSignOutButton } from "@/components/attendee-sign-out-button";
import { BrandMark } from "@/components/brand-mark";
import styles from "@/components/club-portal-masthead-view.module.css";
import { Repeat2, UserRound } from "lucide-react";
import type { AccountSignOutMode } from "@/modules/access/workspace-contexts";
import { clubDirectorRoleLabels, type ClubRole } from "@/modules/organizations/director-grants-domain";

export type ClubMastheadModel = {
  /** The signed-in attendee's name; null when there is no attendee identity to show (a staff act-as, a pending second step). */
  identity: string | null;
  /** Set while a system administrator is acting as the club's director (#442): shown instead of any attendee identity. */
  actingLabel: string | null;
  showSwitchClub: boolean;
  showMyAccount: boolean;
  signOut: AccountSignOutMode;
};

/**
 * What the club masthead shows, decided the way the portal layout decides its
 * own chrome: the attendee account counts only once its second step is not
 * pending (`chromeAccount`), and a staff act-as never shows an attendee
 * identity, My account or Switch club, or reads as a real director grant.
 */
export function clubMastheadModel(input: {
  account: { displayName: string } | null;
  secondStepPending: boolean;
  actingAs: boolean;
  clubCount: number;
  signOut: AccountSignOutMode;
}): ClubMastheadModel {
  if (input.actingAs) {
    return { identity: null, actingLabel: "Acting as club director", showSwitchClub: false, showMyAccount: false, signOut: "none" };
  }
  const chromeAccount = input.secondStepPending ? null : input.account;
  return {
    identity: chromeAccount?.displayName ?? null,
    actingLabel: null,
    showSwitchClub: Boolean(chromeAccount) && input.clubCount > 1,
    showMyAccount: Boolean(chromeAccount),
    signOut: input.signOut,
  };
}

/** The masthead markup: no staff or system links. My account goes to /account on purpose; it is not a role picker. */
export function ClubPortalMastheadView({ model, role }: { model: ClubMastheadModel; role: ClubRole }) {
  return (
    <header className="club-masthead">
      <div className="club-masthead-inner">
        <Link className="club-masthead-brand" href="/account">
          <BrandMark />
          <span><small>IMSDA Events</small><strong>Club portal</strong></span>
        </Link>
        <div className={styles.account}>
          {model.actingLabel && <span className="club-masthead-identity">{model.actingLabel}</span>}
          {model.identity && (
            <span className="club-masthead-identity">
              <span className="club-masthead-name" translate="no">{model.identity}</span>
              <span className="club-masthead-role"> · {clubDirectorRoleLabels[role]}</span>
            </span>
          )}
          {model.showSwitchClub && <Link className={styles.action} href="/account/clubs"><Repeat2 aria-hidden="true" size={16} />Switch club</Link>}
          {model.showMyAccount && <Link className={styles.action} href="/account"><UserRound aria-hidden="true" size={16} />My account</Link>}
          {model.signOut !== "none" && <AttendeeSignOutButton className={styles.action} endStaffSession={model.signOut === "both"} />}
        </div>
      </div>
    </header>
  );
}
