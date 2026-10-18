import { z } from "zod";
import { getCurrentSession } from "@/modules/access/current-session";
import { rejectCrossOriginRequest } from "@/modules/access/request-security";
import { logError } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";
import { getNotificationDefinition, isNotificationKey, type NotificationKey } from "@/modules/notifications/catalog";
import { listNotificationSwitches, setNotificationEnabled } from "@/modules/notifications/settings";
import {
  getPlatformSettings,
  platformAddressesInputSchema,
  updatePlatformAddresses,
} from "@/modules/system-admin/platform-settings";

/**
 * Notification switches and the three alert addresses are global, so they are
 * gated on the global role directly (the same rule as platform settings): there
 * is no event to scope them to.
 */
async function requireSystemAdmin() {
  const { user } = await getCurrentSession();
  if (!user || user.globalRole !== "SYSTEM_ADMIN") return null;
  return user;
}

function forbidden() {
  return Response.json(
    {
      error: "SYSTEM_ADMIN_REQUIRED",
      message: "Only a system administrator can manage notifications.",
    },
    { status: 403 },
  );
}

async function currentAddresses() {
  const settings = await getPlatformSettings();
  return {
    supportContact: settings.supportContact,
    securityAlertEmail: settings.securityAlertEmail,
    newClubApplicationEmail: settings.newClubApplicationEmail,
  };
}

const switchBodySchema = z.object({
  key: z.string().refine(isNotificationKey, "That is not a known notification."),
  enabled: z.boolean(),
  /** Sent after the person confirmed the warning for an alert that asks for one. */
  confirmed: z.boolean().optional(),
}).strict();

/**
 * All three keys must be sent, blank to clear one. The address schema alone treats a missing key as blank, so a partial
 * request (or a client that forgot one) would silently clear a saved address.
 */
const addressKeys = ["supportContact", "securityAlertEmail", "newClubApplicationEmail"] as const;
const addressesBodySchema = z.object({
  addresses: z.record(z.string(), z.unknown())
    .refine(
      (value) => addressKeys.every((key) => key in value),
      "Send all three addresses; leave one blank to clear it.",
    )
    .pipe(platformAddressesInputSchema),
}).strict();

async function getHandler() {
  const user = await requireSystemAdmin();
  if (!user) return forbidden();
  return Response.json({
    switches: await listNotificationSwitches(),
    addresses: await currentAddresses(),
  });
}

async function patchHandler(request: Request) {
  const originError = rejectCrossOriginRequest(request);
  if (originError) return originError;
  const user = await requireSystemAdmin();
  if (!user) return forbidden();
  try {
    const body: unknown = await request.json();

    if (typeof body === "object" && body !== null && "addresses" in body) {
      const { addresses } = addressesBodySchema.parse(body);
      return Response.json({ addresses: await updatePlatformAddresses(addresses, user.id) });
    }

    const input = switchBodySchema.parse(body);
    const key = input.key as NotificationKey;
    const definition = getNotificationDefinition(key);
    // Enforced here and not only in the page, so a script cannot skip the warning.
    if (!input.enabled && definition.confirmBeforeOff && input.confirmed !== true) {
      return Response.json(
        {
          error: "CONFIRMATION_REQUIRED",
          message: definition.confirmBeforeOff.message,
        },
        { status: 409 },
      );
    }
    await setNotificationEnabled(key, input.enabled, user.id);
    return Response.json({ switches: await listNotificationSwitches() });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        {
          error: "INVALID_NOTIFICATION_SETTINGS",
          message: error.issues[0]?.message ?? "Review the notification settings and try again.",
          issues: error.issues,
        },
        { status: 400 },
      );
    }
    if (error instanceof SyntaxError) {
      return Response.json(
        { error: "INVALID_JSON", message: "The request is not valid JSON." },
        { status: 400 },
      );
    }
    logError("Updating notification settings failed", error);
    return Response.json(
      {
        error: "NOTIFICATION_SETTINGS_UPDATE_FAILED",
        message: "The notification settings could not be saved.",
      },
      { status: 500 },
    );
  }
}

export const GET = withRequestContext(getHandler);
export const PATCH = withRequestContext(patchHandler);
