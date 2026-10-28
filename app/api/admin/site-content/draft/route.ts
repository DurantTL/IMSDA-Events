import { withRequestContext } from "@/lib/request-context";
import { discardHubDraft, getSiteContentAdminState, saveHubDraft } from "@/modules/site-content/hub-content";
import { readDraftBase, readJsonBody, siteContentRoute } from "@/modules/site-content/route-helpers";

/** The working draft (#111): read it, save it, throw it away. Saving never changes what visitors see. */
export const GET = withRequestContext((request: Request) =>
  siteContentRoute(request, { write: false }, async () => {
    const state = await getSiteContentAdminState();
    return { draft: state.draft, content: state.content };
  }));

export const PUT = withRequestContext((request: Request) =>
  siteContentRoute(request, { write: true }, async (user) => {
    const body = await readJsonBody(request);
    const note = typeof body.note === "string" ? body.note : null;
    return { draft: await saveHubDraft(body.content, note, user.id, readDraftBase(body)) };
  }));

export const DELETE = withRequestContext((request: Request) =>
  siteContentRoute(request, { write: true }, async (user) => {
    await discardHubDraft(user.id, readDraftBase(await readJsonBody(request)));
    return { discarded: true };
  }));
