import { BackLink } from "@/components/back-link";
import { DashboardTabs } from "@/components/dashboard-tabs";
import { buildAdminSectionNav, type AdminBackLink, type AdminSection, type AdminSectionNav } from "@/components/admin-section-nav";
import styles from "./admin-section-header.module.css";

/**
 * The header at the top of every admin page (#1274): the section's name, the section's main pages as the shared tab
 * row (the current one marked), and, on a page deeper than those, one plain "Back to <parent>" link. The links are
 * ordinary links to the parent page, never `history.back()`. It draws what `buildAdminSectionNav` decided and nothing
 * else, so a page never shows a link its viewer cannot open.
 */
export function AdminSectionHeader({ nav }: { nav: AdminSectionNav }) {
  return (
    <div className={styles.header} data-testid="admin-section-header" data-section={nav.section}>
      <p className={`eyebrow ${styles.name}`}>{nav.name}</p>
      <DashboardTabs label={nav.navLabel} tabs={nav.tabs} />
      {nav.back ? <BackLink href={nav.back.href} variant="staff">{nav.back.label}</BackLink> : null}
    </div>
  );
}

/**
 * The header for a page whose section is already known (a dashboard, or a page only System administrators open): it
 * builds the model itself, with no role lookup, so it is a plain synchronous component.
 */
export function AdminSectionHeaderFor({
  section,
  path,
  clubYear,
  waitingApplications,
  eventId,
  parentName,
  viaParent,
  back,
}: {
  section: AdminSection;
  path: string;
  clubYear?: string;
  waitingApplications?: number;
  eventId?: string | null;
  parentName?: string;
  viaParent?: boolean;
  back?: AdminBackLink | null;
}) {
  return <AdminSectionHeader nav={buildAdminSectionNav({ section, pathname: path, clubYear, waitingApplications, eventId, parentName, viaParent, back })} />;
}
