import "server-only";

import type { EmailSuppressionReason, EventMessageSettings, Prisma, PrismaClient } from "@prisma/client";
import type { getPrisma } from "@/lib/prisma";
import { isAccountEmailConfigured } from "@/modules/communications/account-email";
import { suppressionLabel, suppressionSkipNote } from "@/modules/communications/suppression-labels";

/**
 * Whether email for an event really leaves the building, and from where (#1043). This is the one place that decides it.
 * Every send path, retry, readiness check and settings page reads these functions and never `EventMessageSettings.deliveryMode`
 * (the retired column), which `tests/effective-delivery-1043.test.ts` enforces.
 *
 * - Paused (`EventMessageSettings.deliveryPaused`, set only by a system administrator): capture only, nothing is sent.
 * - Otherwise the platform mode:
 *   - environment not configured (no provider key or account email sender: dev and CI): capture locally;
 *   - environment configured but the central sender address is blank: `SENDER_MISSING`. Messages are NOT captured (a
 *     capture is terminal and would lose them): they queue and stay PENDING, nothing is sent, and they go out once the
 *     sender is set. The mode stays `EXTERNAL_EMAIL` so every path queues them, and delivery refuses with
 *     EXTERNAL_EMAIL_NOT_CONFIGURED until then;
 *   - otherwise real email (`ON`).
 *
 * Suppressed addresses (#863): a hard bounce or a spam complaint reported by SES stops ALL email to that address,
 * confirmations and receipts included, until a system administrator re-enables it. That is a per-recipient decision, so it
 * is made here too (`checkRecipientDeliverable`), and the one delivery worker every send path ends in asks it right before
 * the provider call. Soft bounces are recorded and never suppress.
 *
 * The From address is always the platform's central sender. An event overrides only its display name and reply-to.
 *
 * The `deliveryMode` property on the objects returned here is the EFFECTIVE mode. Paused and unconfigured both resolve to
 * `LOCAL_CAPTURE` (capture only); `DISABLED` is no longer produced.
 */

export type EffectiveDeliveryMode = "DISABLED" | "LOCAL_CAPTURE" | "EXTERNAL_EMAIL";
export type EffectiveDeliveryReason = "PAUSED" | "NOT_CONFIGURED" | "SENDER_MISSING" | "ON";

export type EffectiveDelivery = { mode: EffectiveDeliveryMode; reason: EffectiveDeliveryReason };

export type CentralSender = { name: string; email: string | null; replyTo: string | null };

export const FALLBACK_CENTRAL_SENDER_NAME = "IMSDA Events";

type EmailSettingsClient = Prisma.TransactionClient | ReturnType<typeof getPrisma>;

/** Whether this environment can send real email at all: the existing account-email and provider checks. */
export function isEmailEnvironmentConfigured(): boolean {
  try {
    return isAccountEmailConfigured();
  } catch {
    // An invalid environment is "not configured": capture, never an unexpected send.
    return false;
  }
}

/** Whether real email can go out now: the environment is configured and the central sender address is set. */
export function isPlatformEmailConfigured(centralSenderEmail: string | null | undefined): boolean {
  return Boolean(centralSenderEmail?.trim()) && isEmailEnvironmentConfigured();
}

/** Pure decision. Paused wins over everything; an unconfigured environment captures; a blank sender holds. */
export function resolveEffectiveDelivery(input: { paused: boolean; environmentConfigured: boolean; senderSet: boolean }): EffectiveDelivery {
  if (input.paused) return { mode: "LOCAL_CAPTURE", reason: "PAUSED" };
  if (!input.environmentConfigured) return { mode: "LOCAL_CAPTURE", reason: "NOT_CONFIGURED" };
  if (!input.senderSet) return { mode: "EXTERNAL_EMAIL", reason: "SENDER_MISSING" };
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
  environmentConfigured = isEmailEnvironmentConfigured(),
): Omit<Row, "deliveryMode" | "senderName" | "senderEmail" | "replyToEmail">
  & Pick<EventEmailSettings, "deliveryMode" | "deliveryReason" | "senderName" | "senderEmail" | "replyToEmail" | "replyToOverride" | "central"> {
  const { mode, reason } = resolveEffectiveDelivery({ paused: row.deliveryPaused, environmentConfigured, senderSet: Boolean(central.email) });
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

/**
 * The event's settings, resolved. An event with no settings row yet is not paused, so it gets the same defaults a new
 * event would (the central display name, no reply-to of its own) and the platform's effective mode. Pass
 * `{ fallback: false }` to get `null` instead (readiness reports a missing row).
 */
export async function loadEventEmailSettings(
  client: EmailSettingsClient,
  eventId: string,
  options: { fallback?: boolean } = {},
): Promise<EventEmailSettings | null> {
  const [row, central] = await Promise.all([
    client.eventMessageSettings.findUnique({ where: { eventId } }),
    loadCentralSender(client),
  ]);
  if (row) return resolveEventEmailSettings(row, central) as EventEmailSettings;
  if (options.fallback === false) return null;
  const epoch = new Date(0);
  return resolveEventEmailSettings({
    id: "",
    eventId,
    deliveryMode: "LOCAL_CAPTURE" as const,
    deliveryPaused: false,
    deliveryPausedAt: null,
    deliveryPausedByUserId: null,
    senderName: central.name,
    senderEmail: null,
    replyToEmail: null,
    internalNotificationEmails: [],
    createdAt: epoch,
    updatedAt: epoch,
  }, central) as EventEmailSettings;
}

export async function loadEventEmailSettingsOrThrow(client: EmailSettingsClient, eventId: string): Promise<EventEmailSettings> {
  const settings = await loadEventEmailSettings(client, eventId, { fallback: false });
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
  return { ...resolveEffectiveDelivery({ paused, environmentConfigured: isEmailEnvironmentConfigured(), senderSet: Boolean(central.email) }), paused };
}

/** The columns written when a system administrator pauses or resumes an event. */
export function pauseFields(paused: boolean, actorUserId: string, now: Date) {
  return paused
    ? { deliveryPaused: true, deliveryPausedAt: now, deliveryPausedByUserId: actorUserId }
    : { deliveryPaused: false, deliveryPausedAt: null, deliveryPausedByUserId: null };
}


// --- Suppressed addresses (#863) ----------------------------------------------------------------------------------

export type AddressSuppression = { reason: EmailSuppressionReason; suppressedAt: Date };

type SuppressionClient = Pick<PrismaClient, "emailAddressSuppression"> | Pick<Prisma.TransactionClient, "emailAddressSuppression">;

/** Addresses are compared trimmed and lower-cased, on both sides, everywhere suppression looks at one. */
export function normalizeSuppressionEmail(email: string): string {
  return email.trim().toLowerCase();
}

export { suppressionLabel, suppressionSkipNote };

/** The active suppression of one address, or null. Active means not re-enabled. */
export async function findActiveAddressSuppression(client: SuppressionClient, email: string): Promise<AddressSuppression | null> {
  const normalized = normalizeSuppressionEmail(email);
  if (!normalized) return null;
  const row = await client.emailAddressSuppression.findFirst({
    where: { normalizedEmail: normalized, reenabledAt: null },
    select: { reason: true, suppressedAt: true },
  });
  return row ?? null;
}

/** The active suppressions among many addresses, keyed by normalized address. */
export async function findActiveAddressSuppressions(client: SuppressionClient, emails: readonly string[]): Promise<Map<string, AddressSuppression>> {
  const normalized = [...new Set(emails.map(normalizeSuppressionEmail).filter(Boolean))];
  const found = new Map<string, AddressSuppression>();
  for (let offset = 0; offset < normalized.length; offset += 500) {
    const rows = await client.emailAddressSuppression.findMany({
      where: { normalizedEmail: { in: normalized.slice(offset, offset + 500) }, reenabledAt: null },
      select: { normalizedEmail: true, reason: true, suppressedAt: true },
    });
    for (const row of rows) found.set(row.normalizedEmail, { reason: row.reason, suppressedAt: row.suppressedAt });
  }
  return found;
}

export type RecipientDelivery =
  | { deliverable: true }
  | { deliverable: false; reason: "ADDRESS_SUPPRESSED"; suppression: AddressSuppression; note: string };

/** Pure decision: an active suppression of the recipient's address means nothing is sent to it, whatever the event says. */
export function resolveRecipientDelivery(suppression: AddressSuppression | null): RecipientDelivery {
  if (!suppression) return { deliverable: true };
  return { deliverable: false, reason: "ADDRESS_SUPPRESSED", suppression, note: suppressionSkipNote(suppression.reason) };
}

/** Whether email may go to this address now. The lookup can throw; callers fail closed (retry later, never send). */
export async function checkRecipientDeliverable(client: SuppressionClient, email: string): Promise<RecipientDelivery> {
  return resolveRecipientDelivery(await findActiveAddressSuppression(client, email));
}
