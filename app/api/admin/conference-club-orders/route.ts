import { liveJson } from "@/lib/live-list-response";
import { withRequestContext } from "@/lib/request-context";
import { clubOrderApiError } from "@/modules/club-orders/api-errors";
import { loadConferenceOrdersForStaff } from "@/modules/club-orders/conference-repository";
import { requireClubsAdministration } from "@/modules/organizations/access";

/** Conference club orders for youth department staff (#1688): system administrators and Clubs Administrators (#1232), the same gate as the club supply catalog. */
async function getHandler() {
  try {
    await requireClubsAdministration();
    return liveJson(await loadConferenceOrdersForStaff());
  } catch (error) {
    return clubOrderApiError(error, "Loading the conference club orders");
  }
}

export const GET = withRequestContext(getHandler);
