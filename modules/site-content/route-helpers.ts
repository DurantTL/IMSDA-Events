import { logError } from "@/lib/logger";
import { AccessDeniedError } from "@/modules/access/authorization";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { requireSiteContentEditor } from "@/modules/access/site-content-editor";
import { SiteContentError, type DraftBase } from "@/modules/site-content/hub-content";

const noStore = { "Cache-Control": "no-store" };

export function jsonOk(body: unknown, status = 200) {
  return Response.json(body, { status, headers: noStore });
}

/**
 * The shared shell of the site content routes (#111): a write is refused when cross-origin, then every call re-checks
 * `canManageSiteContent` on the server, and failures come back as plain-words 4xx messages. `run` gets the signed-in
 * user and returns the JSON body.
 */
export async function siteContentRoute(
  request: Request,
  options: { write: boolean },
  run: (user: { id: string }) => Promise<unknown>,
  successStatus = 200,
): Promise<Response> {
  if (options.write) {
    const originError = rejectCrossOriginRequest(request);
    if (originError) return originError;
  }
  try {
    const user = await requireSiteContentEditor();
    return jsonOk(await run(user), successStatus);
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      return Response.json({ error: error.code, message: error.message }, { status: error.status, headers: noStore });
    }
    if (error instanceof SiteContentError) {
      return Response.json({ error: error.code, message: error.message }, { status: error.status, headers: noStore });
    }
    logError("Site content request failed", error);
    return Response.json({ error: "SITE_CONTENT_FAILED", message: "That could not be saved. Try again." }, { status: 500, headers: noStore });
  }
}

/** The JSON body of a write, or an empty object when it is missing or not JSON. */
export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * The draft the editor last saw, from a body's `base` ({ id, updatedAt }, or null for "no draft"); undefined when the
 * caller sent none, which skips the check (#111).
 */
export function readDraftBase(body: Record<string, unknown>): DraftBase | undefined {
  if (!("base" in body)) return undefined;
  const base = body.base;
  if (base === null) return null;
  if (base && typeof base === "object" && typeof (base as Record<string, unknown>).id === "string" && typeof (base as Record<string, unknown>).updatedAt === "string") {
    return { id: (base as { id: string }).id, updatedAt: (base as { updatedAt: string }).updatedAt };
  }
  // A malformed base can never match, so it is a conflict rather than a skipped check.
  return { id: "", updatedAt: "" };
}
