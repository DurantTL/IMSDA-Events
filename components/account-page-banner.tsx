import type { ReactNode } from "react";
import { AccountPortalTabs } from "@/components/account-portal-tabs";

/**
 * The attendee account's page banner (#1555): the club portal's full-width navy band (`club-banner` in globals.css)
 * with the page title and its subtitle lines, then the account tabs directly under it (masthead, band, tabs: the club
 * portal's order). Every attendee page under the portal layout renders this, so the tabs never go missing. `context` is a short line naming where the page sits (an event, a role).
 */
export function AccountPageBanner({
  title,
  context,
  children,
  label,
}: {
  title: ReactNode;
  context?: ReactNode;
  children?: ReactNode;
  /** The band's accessible name; defaults to the page's role as a region of the account. */
  label?: string;
}) {
  return (
    <>
    <section aria-label={label ?? "Page title"} className="club-banner account-page-banner">
      <div className="club-banner-inner">
        <div className="club-banner-identity">
          <h1>{title}</h1>
          {context && <p>{context}</p>}
          {children}
        </div>
      </div>
    </section>
    <AccountPortalTabs />
    </>
  );
}
