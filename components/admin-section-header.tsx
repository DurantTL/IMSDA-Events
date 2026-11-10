import { PageHeader } from "@/components/page-header";
import { DashboardTabs } from "@/components/dashboard-tabs";
import { buildAdminSectionNav, type AdminBackLink, type AdminSection, type AdminSectionNav } from "@/components/admin-section-nav";
import styles from "./admin-section-header.module.css";

/**
 * The header at the top of every admin page (#1274): the section's name, the page's own views or anchors, and, on a page
 * deeper than the section's main pages, one plain "Back to <parent>" link. The section's main pages are the shell's one
 * row of tabs since #1565, so this header no longer draws them a second time. The links are
 * ordinary links to the parent page, never `history.back()`. It draws what `buildAdminSectionNav` decided and nothing
 * else, so a page never shows a link its viewer cannot open.
 */
export function AdminSectionHeader({ nav }: { nav: AdminSectionNav }) {
  return (
    <PageHeader
      back={nav.back ? { href: nav.back.href, label: nav.back.label } : undefined}
      below={(nav.localTabs?.length ?? 0) > 1 ? <div className={styles.localNavigation}><DashboardTabs label={`${nav.name} page views`} tabs={nav.localTabs!} /></div> : undefined}
      eyebrow={nav.name}
      legacy={{ root: styles.header, eyebrow: `eyebrow ${styles.name}`, testId: "admin-section-header", data: { section: nav.section } }}
    />
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
