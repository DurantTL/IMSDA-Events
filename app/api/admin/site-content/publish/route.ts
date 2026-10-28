import { withRequestContext } from "@/lib/request-context";
import { publishHubDraft } from "@/modules/site-content/hub-content";
import { readDraftBase, readJsonBody, siteContentRoute } from "@/modules/site-content/route-helpers";

/** Publishes the working draft: visitors see it from the next page load (#111). The body's `base` ties it to the draft the editor saw. */
export const POST = withRequestContext((request: Request) =>
  siteContentRoute(request, { write: true }, async (user) => ({ published: await publishHubDraft(user.id, new Date(), readDraftBase(await readJsonBody(request))) })));
