import "server-only";

import { getPrisma } from "@/lib/prisma";
import { logWarn } from "@/lib/logger";
import { openSecret, sealSecret } from "@/lib/secret-box";
import { writeAuditLog } from "@/modules/audit/audit-service";
import {
  buildDiscordPayload,
  checkDiscordWebhookAddress,
  DISCORD_GROUPS,
  DISCORD_TEST_MESSAGE,
  describeDiscordAttempt,
  webhookLast4,
  type DiscordGroup,
  type DiscordGroupSwitches,
  type DiscordMessage,
  type DiscordTestResult,
} from "@/modules/operations/discord-alerts-domain";

/**
 * The Discord channel for system alerts (#2048), set on Platform settings by a system administrator.
 *
 * The webhook address is a secret. It is sealed at rest under its own purpose, opened only here to post, and never
 * returned to a page, written to a log or put in an audit row. What the page gets is "connected", the last 4
 * characters, who set it and when. A Discord failure is logged as a fixed word and a status number, and never throws
 * into a scan, a heartbeat or a save.
 */

const SETTINGS_ID = "platform";
const SEAL_PURPOSE = "discord-alert-webhook";
const DISCORD_TIMEOUT_MS = 5000;

const GROUP_COLUMN = {
  "site-health": "discordAlertSiteHealth",
  deploys: "discordAlertDeploys",
  backups: "discordAlertBackups",
  "practice-runs": "discordAlertPracticeRuns",
} as const satisfies Record<DiscordGroup, string>;

export type DiscordAlertSettingsView = {
  connected: boolean;
  last4: string | null;
  setAt: string | null;
  setByName: string | null;
  groups: DiscordGroupSwitches;
  lastDeliveredAt: string | null;
  lastFailedAt: string | null;
};

export class DiscordAlertSettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiscordAlertSettingsError";
  }
}

/** What the page is given. Built field by field, so the sealed value cannot ride along. */
export async function getDiscordAlertSettingsView(): Promise<DiscordAlertSettingsView> {
  const row = await getPrisma().platformSettings.findUnique({
    where: { id: SETTINGS_ID },
    select: {
      discordWebhookLast4: true,
      discordWebhookSetAt: true,
      discordWebhookSetByUserId: true,
      discordAlertSiteHealth: true,
      discordAlertDeploys: true,
      discordAlertBackups: true,
      discordAlertPracticeRuns: true,
      discordLastDeliveredAt: true,
      discordLastFailedAt: true,
      sealedDiscordWebhook: true,
    },
  });
  const setBy = row?.discordWebhookSetByUserId
    ? await getPrisma().user.findUnique({ where: { id: row.discordWebhookSetByUserId }, select: { displayName: true } })
    : null;
  return {
    connected: Boolean(row?.sealedDiscordWebhook),
    last4: row?.sealedDiscordWebhook ? row.discordWebhookLast4 ?? null : null,
    setAt: row?.sealedDiscordWebhook ? row.discordWebhookSetAt?.toISOString() ?? null : null,
    setByName: row?.sealedDiscordWebhook ? setBy?.displayName ?? null : null,
    groups: {
      "site-health": row?.discordAlertSiteHealth ?? true,
      deploys: row?.discordAlertDeploys ?? true,
      backups: row?.discordAlertBackups ?? true,
      "practice-runs": row?.discordAlertPracticeRuns ?? true,
    },
    lastDeliveredAt: row?.discordLastDeliveredAt?.toISOString() ?? null,
    lastFailedAt: row?.discordLastFailedAt?.toISOString() ?? null,
  };
}

/** Checks, seals and stores the address. The audit row names the action only. */
export async function saveDiscordWebhook(rawAddress: unknown, actorUserId: string, now = new Date()): Promise<DiscordAlertSettingsView> {
  const checked = checkDiscordWebhookAddress(rawAddress);
  if (!checked.ok) throw new DiscordAlertSettingsError(checked.message);
  let sealed: string;
  try {
    sealed = sealSecret(checked.url, SEAL_PURPOSE);
  } catch {
    throw new DiscordAlertSettingsError("The address could not be stored because the server's encryption key is not set up.");
  }
  const data = {
    sealedDiscordWebhook: sealed,
    discordWebhookLast4: webhookLast4(checked.url),
    discordWebhookSetAt: now,
    discordWebhookSetByUserId: actorUserId,
  };
  await getPrisma().$transaction(async (tx) => {
    await tx.platformSettings.upsert({
      where: { id: SETTINGS_ID },
      update: data,
      create: { id: SETTINGS_ID, ...data },
    });
    await writeAuditLog(
      { actorUserId, action: "DISCORD_ALERTS_ADDRESS_SET", entityType: "PlatformSettings", entityId: SETTINGS_ID, summary: "Set the Discord channel for system alerts." },
      tx,
    );
  });
  return getDiscordAlertSettingsView();
}

export async function removeDiscordWebhook(actorUserId: string): Promise<DiscordAlertSettingsView> {
  const data = { sealedDiscordWebhook: null, discordWebhookLast4: null, discordWebhookSetAt: null, discordWebhookSetByUserId: null };
  await getPrisma().$transaction(async (tx) => {
    await tx.platformSettings.upsert({
      where: { id: SETTINGS_ID },
      update: data,
      create: { id: SETTINGS_ID, ...data },
    });
    await writeAuditLog(
      { actorUserId, action: "DISCORD_ALERTS_ADDRESS_REMOVED", entityType: "PlatformSettings", entityId: SETTINGS_ID, summary: "Removed the Discord channel for system alerts." },
      tx,
    );
  });
  return getDiscordAlertSettingsView();
}

export async function saveDiscordGroups(groups: DiscordGroupSwitches, actorUserId: string): Promise<DiscordAlertSettingsView> {
  const data = Object.fromEntries(DISCORD_GROUPS.map((group) => [GROUP_COLUMN[group], groups[group]])) as Record<(typeof GROUP_COLUMN)[DiscordGroup], boolean>;
  await getPrisma().$transaction(async (tx) => {
    await tx.platformSettings.upsert({
      where: { id: SETTINGS_ID },
      update: data,
      create: { id: SETTINGS_ID, ...data },
    });
    await writeAuditLog(
      {
        actorUserId,
        action: "DISCORD_ALERTS_GROUPS_CHANGED",
        entityType: "PlatformSettings",
        entityId: SETTINGS_ID,
        summary: "Changed which groups of system alerts go to Discord.",
        metadata: { groups },
      },
      tx,
    );
  });
  return getDiscordAlertSettingsView();
}

/** The open address when the channel is connected and (when a group is given) that group is on. Null otherwise; never throws. */
async function readDestination(group?: DiscordGroup): Promise<string | null> {
  try {
    const row = await getPrisma().platformSettings.findUnique({
      where: { id: SETTINGS_ID },
      select: {
        sealedDiscordWebhook: true,
        discordAlertSiteHealth: true,
        discordAlertDeploys: true,
        discordAlertBackups: true,
        discordAlertPracticeRuns: true,
      },
    });
    if (!row?.sealedDiscordWebhook) return null;
    if (group && row[GROUP_COLUMN[group]] === false) return null;
    return openSecret(row.sealedDiscordWebhook, SEAL_PURPOSE);
  } catch (error) {
    logWarn("The Discord alert address could not be read.", { error: error instanceof Error ? error.name : typeof error });
    return null;
  }
}

/** Whether a message for this group would be posted right now. */
export async function isDiscordGroupActive(group: DiscordGroup): Promise<boolean> {
  return (await readDestination(group)) !== null;
}

export type DiscordDelivery = { attempted: boolean; delivered: boolean; status?: number | null };

async function recordDelivery(delivered: boolean, now: Date) {
  try {
    await getPrisma().platformSettings.update({
      where: { id: SETTINGS_ID },
      data: delivered ? { discordLastDeliveredAt: now } : { discordLastFailedAt: now },
    });
  } catch (error) {
    logWarn("Could not record the Discord delivery result.", { error: error instanceof Error ? error.name : typeof error });
  }
}

async function post(url: string, message: DiscordMessage, fetchImpl: typeof fetch): Promise<DiscordDelivery> {
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildDiscordPayload(message)),
      signal: AbortSignal.timeout(DISCORD_TIMEOUT_MS),
    });
    return { attempted: true, delivered: response.ok, status: response.status };
  } catch (error) {
    logWarn("Discord could not be reached.", { error: error instanceof Error ? error.name : typeof error });
    return { attempted: true, delivered: false, status: null };
  }
}

/**
 * Posts one message to the channel when it is connected and the message's group is on. Never throws. The result is a
 * fixed word and a status number: no address, no body.
 */
export async function postToDiscord(
  group: DiscordGroup,
  message: DiscordMessage,
  options: { fetchImpl?: typeof fetch; now?: Date } = {},
): Promise<DiscordDelivery> {
  try {
    const url = await readDestination(group);
    if (!url) return { attempted: false, delivered: false };
    const delivery = await post(url, message, options.fetchImpl ?? fetch);
    if (!delivery.delivered) logWarn("An alert could not be delivered to Discord.", { group, status: delivery.status ?? null });
    await recordDelivery(delivery.delivered, options.now ?? new Date());
    return delivery;
  } catch (error) {
    logWarn("Posting to Discord failed.", { group, error: error instanceof Error ? error.name : typeof error });
    return { attempted: true, delivered: false, status: null };
  }
}

/** The "Send a test message" button: posts one test line whatever the group switches say, and says what happened in words. */
export async function sendDiscordTestMessage(
  actorUserId: string,
  options: { fetchImpl?: typeof fetch; now?: Date } = {},
): Promise<DiscordTestResult> {
  const url = await readDestination();
  if (!url) return { state: "not-connected", message: "Paste a Discord webhook address and save it first." };
  const delivery = await post(url, DISCORD_TEST_MESSAGE, options.fetchImpl ?? fetch);
  await recordDelivery(delivery.delivered, options.now ?? new Date());
  try {
    await writeAuditLog({ actorUserId, action: "DISCORD_ALERTS_TEST_SENT", entityType: "PlatformSettings", entityId: SETTINGS_ID, summary: "Sent a test message to the Discord alert channel." });
  } catch (error) {
    logWarn("Could not audit the Discord test message.", { error: error instanceof Error ? error.name : typeof error });
  }
  return describeDiscordAttempt(delivery);
}
