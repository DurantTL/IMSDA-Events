import { z } from "zod";
import { logError } from "@/lib/logger";
import { isLockTimeoutError, isSerializationFailure } from "@/lib/prisma-errors";
import { AccessDeniedError, effectivePermissions, requirePermission } from "@/modules/access/authorization";
import { getCurrentSession } from "@/modules/access/current-session";
import type { EventPermission } from "@/modules/access/permissions";
import { findActiveMembership } from "@/modules/events/repository";
import { AssetError, assetErrorStatus } from "@/modules/issued-assets/errors";

const noStore = { "Cache-Control": "no-store" };

/**
 * The server-side check every issued-asset route makes. The catalog (types, items, bulk ranges) is event setup
 * (CONFIGURE_EVENT, the permission lodging inventory uses); issuing, transferring, replacing, correcting and looking
 * up are the check-in desk's work (MANAGE_CHECK_IN).
 */
export async function requireAssetStaff(eventId: string, permission: Extract<EventPermission, "CONFIGURE_EVENT" | "MANAGE_CHECK_IN">) {
  const access = await requirePermission(await getCurrentSession(), eventId, permission, findActiveMembership);
  // Corrections of older issues and putting a replaced item straight back in stock need event setup permission as well.
  const canConfigure = new Set(effectivePermissions(access.user, access.membership)).has("CONFIGURE_EVENT");
  return { userId: access.user.id, canConfigure };
}

export function assetApiError(error: unknown, action: string) {
  if (error instanceof AccessDeniedError) {
    return Response.json({ error: error.code, message: error.message }, { status: error.status, headers: noStore });
  }
  if (error instanceof z.ZodError) {
    return Response.json({ error: "INVALID_ASSET_INPUT", message: error.issues[0]?.message ?? "Review the details.", issues: error.issues }, { status: 400, headers: noStore });
  }
  if (error instanceof SyntaxError) {
    return Response.json({ error: "INVALID_JSON", message: "The request is not valid JSON." }, { status: 400, headers: noStore });
  }
  if (error instanceof AssetError) {
    return Response.json({ error: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) }, { status: assetErrorStatus(error.code), headers: noStore });
  }
  if (isLockTimeoutError(error)) {
    return Response.json({ error: "BUSY", message: "That is being updated by someone else right now. Nothing was saved. Try again in a moment." }, { status: 503, headers: noStore });
  }
  if (isSerializationFailure(error)) {
    return Response.json({ error: "BUSY", message: "Another change landed at the same time. Nothing was saved. Try again." }, { status: 409, headers: noStore });
  }
  logError(`${action} failed`, error);
  return Response.json({ error: "ASSET_REQUEST_FAILED", message: `${action} could not be completed.` }, { status: 500, headers: noStore });
}

export const assetJson = (body: unknown, status = 200) => Response.json(body, { status, headers: noStore });
