import type { PublicClubFormsDraftBase } from "@/modules/club-forms/public-index-settings";

/** A JSON object body, or an empty object when the body is missing or not an object (a discard may send none). */
export async function readOptionalJsonObject(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * The draft the editor last saw, from a body's `base` ({ id, updatedAt }, or null for "no draft"); undefined when the
 * caller sent none, which skips the check (#1601).
 */
export function readPublicClubFormsBase(body: Record<string, unknown>): PublicClubFormsDraftBase | undefined {
  if (!("base" in body)) return undefined;
  const base = body.base;
  if (base === null) return null;
  if (base && typeof base === "object" && typeof (base as Record<string, unknown>).id === "string" && typeof (base as Record<string, unknown>).updatedAt === "string") {
    return { id: (base as { id: string }).id, updatedAt: (base as { updatedAt: string }).updatedAt };
  }
  // A malformed base can never match, so it is a conflict rather than a skipped check.
  return { id: "", updatedAt: "" };
}
