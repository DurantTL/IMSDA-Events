import "server-only";

import type { EventMessageSettings, Prisma } from "@prisma/client";
import type { getPrisma } from "@/lib/prisma";
import { isAccountEmailConfigured } from "@/modules/communications/account-email";

/**
 * Whether email for an event really leaves the building, and from where (#1043). This is the one place that decides it.
 * Every send path, retry, readiness check and settings page reads these functions and never `EventMessageSettings.deliveryMode`
 * (the retired column), which `tests/effective-delivery-1043.test.ts` enforces.
 *
 * - Paused (`EventMessageSettings.deliveryPaused`, set only by a system administrator): capture only, nothing is sent.
 * - Otherwise the platform mode: real email where account and provider email is configured in this environment (the same
 *   checks account email uses) and the central sender address is set; capture locally where it is not (dev and CI).
 *
 * The From address is always the platform's central sender. An event overrides only its display name and reply-to.
 *
 * The `deliveryMode` property on the objects returned here is the EFFECTIVE mode. Paused and unconfigured both resolve to
 * `LOCAL_CAPTURE` (capture only); `DISABLED` is no longer produced.
 */

export type EffectiveDeliveryMode = "DISABLED" | "LOCAL_CAPTURE" | "EXTERNAL_EMAIL";
export type EffectiveDeliveryReason = "PAUSED" | "NOT_CONFIGURED" | "ON";

export type EffectiveDelivery = { mode: EffectiveDeliveryMode; reason: EffectiveDeliveryReason };

export type CentralSender = { name: string; email: string | null; replyTo: string | null };

export const FALLBACK_CENTRAL_SENDER_NAME = "IMSDA Events";

type EmailSettingsClient = Prisma.TransactionClient | ReturnType<typeof getPrisma>;

/** Whether this environment can send real email at all: the account-email checks, plus a central sender address. */
export function isPlatformEmailConfigured(centralSenderEmail: string | null | undefined): boolean {
  if (!centralSenderEmail?.trim()) return false;
  try {
    return isAccountEmailConfigured();
  } catch {
    // An invalid environment is "not configured"; failing closed (capture) is never an unexpected send.
    return false;
  }
}

/** Pure decision. Paused wins over everything; unconfigured captures. */
export function resolveEffectiveDelivery(input: { paused: boolean; platformConfigured: boolean }): EffectiveDelivery {
  if (input.paused) return { mode: "LOCAL_CAPTURE", reason: "PAUSED" };
  if (!input.platformConfigured) return { mode: "LOCAL_CAPTURE", reason: "NOT_CONFIGURED" };
  return { mode: "EXTERNAL_EMAIL", reason: "ON" };
}

export async function loadCentralSender(client: EmailSettingsClient): Promise<CentralSender> {
  const row = await client.platformSettings.findUnique({
    where: { id: "platform" },
    select: { defaultSenderName: true, defaultSenderEmail: true, defaultReplyToEmail: true },
  });
  return {
    name: row?.defaultSenderName?.trim() || FALLBACK_CENTRAL_SENDER_NAME,
    email: row?.defaultSenderEmail?.trim() || null,
    replyTo: row?.defaultReplyToEmail?.trim() || null,
  };
}

/** What an event's settings row looks like to every consumer: sender fields resolved, delivery mode effective. */
export type EventEmailSettings = Omit<EventMessageSettings, "deliveryMode" | "senderEmail" | "replyToEmail" | "senderName"> & {
  /** The effective mode, never the stored column. */
  deliveryMode: EffectiveDeliveryMode;
  deliveryReason: EffectiveDeliveryReason;
  /** The event's display name, or the central one when the event has none. */
  senderName: string;
  /** Always the central From address. */
  senderEmail: string | null;
  /** The event's reply-to, else the central one. */
  replyToEmail: string | null;
  /** The event's own reply-to override, blank when it uses the central one (what the settings form edits). */
  replyToOverride: string | null;
  /** The central sender, for read-only display. */
  central: CentralSender;
};

type StoredSettings = Pick<EventMessageSettings, "deliveryPaused" | "senderName" | "replyToEmail">;

/** Pure: resolve one stored row against the central sender. Used by the loader and by tests. */
export function resolveEventEmailSettings<Row extends StoredSettings>(
  row: Row,
  central: CentralSender,
  platformConfigured = isPlatformEmailConfigured(central.email),
): Omit<Row, "deliveryMode" | "senderName" | "senderEmail" | "replyToEmail">
  & Pick<EventEmailSettings, "deliveryMode" | "deliveryReason" | "senderName" | "senderEmail" | "replyToEmail" | "replyToOverride" | "central"> {
  const { mode, reason } = resolveEffectiveDelivery({ paused: row.deliveryPaused, platformConfigured });
  return {
    ...row,
    deliveryMode: mode,
    deliveryReason: reason,
    senderName: row.senderName?.trim() || central.name,
    senderEmail: central.email,
    replyToEmail: row.replyToEmail?.trim() || central.replyTo,
    replyToOverride: row.replyToEmail?.trim() || null,
    central,
  };
}

/** The event's settings, resolved; `null` when the event has no settings row yet (callers keep their capture fallback). */
export async function loadEventEmailSettings(client: EmailSettingsClient, eventId: string): Promise<EventEmailSettings | null> {
  const [row, central] = await Promise.all([
    client.eventMessageSettings.findUnique({ where: { eventId } }),
    loadCentralSender(client),
  ]);
  return row ? resolveEventEmailSettings(row, central) as EventEmailSettings : null;
}

export async function loadEventEmailSettingsOrThrow(client: EmailSettingsClient, eventId: string): Promise<EventEmailSettings> {
  const settings = await loadEventEmailSettings(client, eventId);
  if (!settings) throw new Error(`Event ${eventId} has no message settings.`);
  return settings;
}

/** The effective delivery for an event, with no settings row counting as not paused (a new event). */
export async function getEffectiveDelivery(client: EmailSettingsClient, eventId: string): Promise<EffectiveDelivery & { paused: boolean }> {
  const [row, central] = await Promise.all([
    client.eventMessageSettings.findUnique({ where: { eventId }, select: { deliveryPaused: true } }),
    loadCentralSender(client),
  ]);
  const paused = row?.deliveryPaused ?? false;
  return { ...resolveEffectiveDelivery({ paused, platformConfigured: isPlatformEmailConfigured(central.email) }), paused };
}

/** The columns written when a system administrator pauses or resumes an event. */
export function pauseFields(paused: boolean, actorUserId: string, now: Date) {
  return paused
    ? { deliveryPaused: true, deliveryPausedAt: now, deliveryPausedByUserId: actorUserId }
    : { deliveryPaused: false, deliveryPausedAt: null, deliveryPausedByUserId: null };
}
