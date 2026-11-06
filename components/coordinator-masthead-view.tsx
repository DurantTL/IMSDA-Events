import { PRODUCT_NAME } from "@/lib/brand";
import { PortalMastheadActions } from "@/components/portal-masthead-actions";
import { BrandLink } from "@/components/brand-link";
import { systemRoleText } from "@/modules/access/role-descriptions";
import type { AccountSignOutMode } from "@/modules/access/workspace-contexts";
import type { FormsHelpContact } from "@/modules/system-admin/forms-help-contact";

export const COORDINATOR_ROLE_LABEL = systemRoleText.AREA_COORDINATOR.name;

export type CoordinatorMastheadModel = {
  /** The signed-in coordinator's name; null during a staff act-as and while a second step is pending. */
  identity: string | null;
  /** Shown instead of any identity while a system administrator is acting as an Area Coordinator (#442). */
  actingLabel: string | null;
  /** Only a real coordinator (not an act-as) is offered Waitlists, the same rule as the portal tabs (#599). */
  showWaitlists: boolean;
  signOut: AccountSignOutMode;
};

/**
 * What the coordinator masthead shows, decided the way the club masthead and the
 * portal layout decide their chrome (#1165): the account counts only when its
 * second step is not pending, and a staff act-as shows no identity,
 * Waitlists or sign-out, and never reads as a real coordinator grant.
 */
export function coordinatorMastheadModel(input: {
  account: { displayName: string } | null;
  secondStepPending: boolean;
  actingAs: boolean;
  /** The role the staff member is acting as, so the label never names a role they are not acting as. */
  actingRole?: string | null;
  /** The account's own current Area Coordinator grant. */
  isCoordinator: boolean;
  signOut: AccountSignOutMode;
}): CoordinatorMastheadModel {
  if (input.actingAs) {
    const actingLabel = input.actingRole === "AREA_COORDINATOR" || input.actingRole == null
      ? `Acting as ${COORDINATOR_ROLE_LABEL}`
      : input.actingRole === "CLUB_DIRECTOR" ? "Acting as club director" : "Staff act-as";
    return { identity: null, actingLabel, showWaitlists: false, signOut: "none" };
  }
  const chromeAccount = input.secondStepPending ? null : input.account;
  return {
    identity: chromeAccount?.displayName ?? null,
    actingLabel: null,
    showWaitlists: Boolean(chromeAccount) && input.isCoordinator,
    signOut: input.signOut,
  };
}

/** The masthead markup: IMSDA identity, "Club coordination", the person and role. No staff or system links, no role picker. The same outlined buttons as the club masthead (#1555): the "Your account" drop-down (Profile and security live there), Forms help and Sign out. */
export function CoordinatorMastheadView({ model, formsHelpContact }: { model: CoordinatorMastheadModel; formsHelpContact?: FormsHelpContact }) {
  return (
    <header className="club-masthead coordinator-masthead">
      <div className="club-masthead-inner">
        <BrandLink label="IMAdventist Club coordination, calendar" className="club-masthead-brand" wordmark={<span><small>{PRODUCT_NAME}</small><strong>Club coordination</strong></span>} />
        <PortalMastheadActions
          formsHelpContact={formsHelpContact}
          signOut={model.signOut}
          identity={<>
            {model.actingLabel && <span className="club-masthead-identity">{model.actingLabel}</span>}
            {model.identity && (
              <span className="club-masthead-identity">
                <span className="club-masthead-name" translate="no">{model.identity}</span>
                <span className="club-masthead-role"><span className="club-masthead-sep"> · </span>{COORDINATOR_ROLE_LABEL}</span>
              </span>
            )}
          </>}
        />
      </div>
    </header>
  );
}
