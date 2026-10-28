import { withRequestContext } from "@/lib/request-context";
import { restoreHubRevision } from "@/modules/site-content/hub-content";
import { siteContentRoute } from "@/modules/site-content/route-helpers";

type RouteContext = { params: Promise<{ revisionId: string }> };

/** Publishes a copy of an earlier version again (#111). The earlier version itself is left as it was. */
export const POST = withRequestContext(async (request: Request, context: RouteContext) => {
  const { revisionId } = await context.params;
  return siteContentRoute(request, { write: true }, async (user) => ({ published: await restoreHubRevision(revisionId, user.id) }));
});
