import { AdminSectionHeader } from "@/components/admin-section-header";
import { buildAdminSectionNav, type AdminBackLink, type AdminSection } from "@/components/admin-section-nav";
import { activeAdminSection } from "@/modules/access/admin-section";
import { getCurrentSession } from "@/modules/access/current-session";
import { resolveAreaClubYear } from "@/modules/club-reports/area-export";

/**
 * The section header a server page draws at its top (#1274). The page names itself with `path` (its own path, with any
 * ids filled in); this picks the section from the viewer's active admin role, so a page both Clubs and System
 * administrators open shows the header of the view they are in, and an event page shows the Events header only to an
 * Events Administrator of that event (it draws nothing for anyone else, so those pages render as they always did).
 * The three dashboards pass `section`, which skips the role lookup.
 * - `year`: the page's `?year=`, for the Clubs tabs (the current club year when the page has none).
 * - `eventId`: the event an event page shows, so the tabs stay on it.
 * - `parentName`: names the parent in the back link ("Back to <club>"); `viaParent`: the visitor came from that parent
 *   (a safe `?from=` the page checked), so the link goes back to it. `back` replaces the computed link outright.
 */
export async function AdminPageHeader({
  path,
  section,
  year,
  eventId,
  waitingApplications,
  parentName,
  viaParent,
  back,
}: {
  path: string;
  section?: AdminSection;
  year?: string;
  eventId?: string | null;
  waitingApplications?: number;
  parentName?: string;
  viaParent?: boolean;
  back?: AdminBackLink | null;
}) {
  let resolved = section ?? null;
  if (!resolved) {
    const { user } = await getCurrentSession();
    if (!user) return null;
    resolved = await activeAdminSection(user, path, eventId);
  }
  if (!resolved) return null;
  const nav = buildAdminSectionNav({
    section: resolved,
    pathname: path,
    clubYear: resolved === "clubs" ? resolveAreaClubYear(year) : undefined,
    waitingApplications,
    eventId,
    parentName,
    viaParent,
    back,
  });
  return <AdminSectionHeader nav={nav} />;
}
