import { PRODUCT_NAME } from "@/lib/brand";
import { AccountHeaderActions } from "@/components/account-header-actions";
import { BrandLink } from "@/components/brand-link";
import type { AccountSignOutMode, WorkspaceContext } from "@/modules/access/workspace-contexts";

/**
 * The attendee account's header (#1555): the club portal's masthead row (`club-masthead`), the IMAdventist
 * wordmark over "My account", the signed-in name and the shared outlined buttons. Chrome only. The portal layout hides it
 * on club and coordinator pages, which draw their own masthead.
 */
export function AccountPortalMasthead({ identity, contexts, signOut, staffSignInEnded }: { identity?: string; contexts: WorkspaceContext[]; signOut: AccountSignOutMode; staffSignInEnded?: boolean }) {
  return (
    <header className="club-masthead account-masthead">
      <div className="club-masthead-inner">
        <BrandLink label="IMAdventist My account, calendar" className="club-masthead-brand" wordmark={<span><small>{PRODUCT_NAME}</small><strong>My account</strong></span>} />
        <AccountHeaderActions identity={identity} contexts={contexts} signOut={signOut} staffSignInEnded={staffSignInEnded} />
      </div>
    </header>
  );
}
