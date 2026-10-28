import { withRequestContext } from "@/lib/request-context";
import { publishHubDraft } from "@/modules/site-content/hub-content";
import { siteContentRoute } from "@/modules/site-content/route-helpers";

/** Publishes the working draft: visitors see it from the next page load (#111). */
export const POST = withRequestContext((request: Request) =>
  siteContentRoute(request, { write: true }, async (user) => ({ published: await publishHubDraft(user.id) })));
