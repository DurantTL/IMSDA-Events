import { coordinatorNavItems } from "@/components/area-clubs-subnav";
import { AreaCoordinatorSearch } from "@/components/club-portal-search";
import { currentAreaCoordinator } from "@/modules/organizations/area-coordinators";
import { currentStaffActingContext } from "@/modules/organizations/staff-act-as";
import { accountIsTltDirector } from "@/modules/tlt-directory/access";

/**
 * The search button for the coordinator banner (#1854). Its pages are the coordinator's own tabs, built here on the server
 * the way the shell builds them (Waitlists only for a real coordinator, never a staff act-as; the TLT directory only for a
 * coordinator who is the TLT director, #1686), so the search lists no page
 * the tabs do not. It is chrome: the route and every page check access themselves.
 */
export async function CoordinatorBannerSearch() {
  const [coordinator, acting] = await Promise.all([currentAreaCoordinator(), currentStaffActingContext()]);
  const own = Boolean(coordinator) && !acting;
  const showTlt = own && coordinator ? await accountIsTltDirector(coordinator.id) : false;
  const items = coordinatorNavItems({ showWaitlists: own, showTlt });
  return <AreaCoordinatorSearch pages={items.map(({ href, label }) => ({ href, label }))} />;
}
