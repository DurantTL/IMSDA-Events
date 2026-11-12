import { coordinatorNavItems } from "@/components/area-clubs-subnav";
import { AreaCoordinatorSearch } from "@/components/club-portal-search";
import { currentAreaCoordinator } from "@/modules/organizations/area-coordinators";
import { currentStaffActingContext } from "@/modules/organizations/staff-act-as";

/**
 * The search button for the coordinator banner (#1854). Its pages are the coordinator's own tabs, built here on the server
 * the way the shell builds them (Waitlists only for a real coordinator, never a staff act-as), so the search lists no page
 * the tabs do not. It is chrome: the route and every page check access themselves.
 */
export async function CoordinatorBannerSearch() {
  const [coordinator, acting] = await Promise.all([currentAreaCoordinator(), currentStaffActingContext()]);
  const items = coordinatorNavItems({ showWaitlists: Boolean(coordinator) && !acting });
  return <AreaCoordinatorSearch pages={items.map(({ href, label }) => ({ href, label }))} />;
}
