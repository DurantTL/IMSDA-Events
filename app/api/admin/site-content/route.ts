import { withRequestContext } from "@/lib/request-context";
import { getSiteContentAdminState } from "@/modules/site-content/hub-content";
import { siteContentRoute } from "@/modules/site-content/route-helpers";

/** The working draft, the published version and the history of the homepage and site content (#111). */
export const GET = withRequestContext((request: Request) => siteContentRoute(request, { write: false }, () => getSiteContentAdminState()));
