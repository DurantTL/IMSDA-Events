import {
  SERVER_AUTODEPLOY_JOB,
  SERVER_LOAD_REHEARSAL_JOB,
  SERVER_PREDEPLOY_BACKUP_JOB,
  SERVER_RESTORE_DRILL_JOB,
} from "@/modules/operations/sweep-heartbeat";

/**
 * Alerts to a Discord channel (#2048). Pure: the address check, the message groups, the Discord payload and the
 * mapping from a host job heartbeat to a message. No database, no network, no `server-only`, so tests load it.
 *
 * What may reach Discord: fixed words, counts, job names and short version ids. Never an attendee's name, an email
 * address or any `webhookOnlyDetail`.
 */

export const DISCORD_GROUPS = ["site-health", "deploys", "backups", "practice-runs"] as const;
export type DiscordGroup = (typeof DISCORD_GROUPS)[number];

export const DISCORD_GROUP_LABELS: Record<DiscordGroup, { label: string; help: string }> = {
  "site-health": {
    label: "Site health and errors",
    help: "Email falling behind, failed messages, failed or stuck card payments, and a message when each one is back to normal.",
  },
  deploys: {
    label: "Deploys",
    help: "A new version went live, a deploy failed or is being held, or the database copy before a deploy failed or was skipped.",
  },
  backups: {
    label: "Backups and restore checks",
    help: "The nightly backup failed or is overdue, the off-host copy is overdue, and the weekly restore check passed or failed.",
  },
  "practice-runs": {
    label: "Practice runs",
    help: "The result of a restore drill or a load rehearsal.",
  },
};

export type DiscordGroupSwitches = Record<DiscordGroup, boolean>;

export const ALL_DISCORD_GROUPS_ON: DiscordGroupSwitches = {
  "site-health": true,
  deploys: true,
  backups: true,
  "practice-runs": true,
};

export const DISCORD_USERNAME = "IMAdventist Events";
export const DISCORD_CONTENT_MAX = 2000;

const DISCORD_HOSTS = new Set([
  "discord.com",
  "ptb.discord.com",
  "canary.discord.com",
  "discordapp.com",
  "ptb.discordapp.com",
  "canary.discordapp.com",
]);

export const DISCORD_ADDRESS_ERROR =
  "That is not a Discord channel webhook address. It starts with https://discord.com/api/webhooks/ and has two long parts after it.";

export type DiscordAddressCheck = { ok: true; url: string } | { ok: false; message: string };

/** Accepts only `https://discord.com/api/webhooks/<id>/<token>` (and the discordapp.com, ptb. and canary. spellings). */
export function checkDiscordWebhookAddress(raw: unknown): DiscordAddressCheck {
  if (typeof raw !== "string") return { ok: false, message: DISCORD_ADDRESS_ERROR };
  const text = raw.trim();
  if (!text || text.length > 400) return { ok: false, message: DISCORD_ADDRESS_ERROR };
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return { ok: false, message: DISCORD_ADDRESS_ERROR };
  }
  const plain =
    parsed.protocol === "https:" &&
    DISCORD_HOSTS.has(parsed.hostname) &&
    parsed.port === "" &&
    parsed.username === "" &&
    parsed.password === "" &&
    parsed.search === "" &&
    parsed.hash === "" &&
    /^\/api\/webhooks\/\d{15,25}\/[A-Za-z0-9_-]{20,120}$/.test(parsed.pathname);
  if (!plain) return { ok: false, message: DISCORD_ADDRESS_ERROR };
  return { ok: true, url: `https://${parsed.hostname}${parsed.pathname}` };
}

/** The only part of the address that is ever shown again. */
export function webhookLast4(url: string): string {
  return url.slice(-4);
}

/** How one message reads in Discord. A fixed set of words; `INFO` is a plain notice. */
export type DiscordMessageSeverity = "URGENT" | "WATCH" | "INFO";

export type DiscordMessage = {
  severity: DiscordMessageSeverity;
  summary: string;
  detail?: string;
  /** A "back to normal" message reads differently from a new problem. */
  backToNormal?: boolean;
};

export type DiscordPayload = {
  username: string;
  content: string;
  allowed_mentions: { parse: [] };
};

const SEVERITY_WORD: Record<DiscordMessageSeverity, string> = { URGENT: "URGENT", WATCH: "Watch", INFO: "Info" };

/** Builds the Discord body. It takes only the fields that are safe to send; there is no way to pass anything else. */
export function buildDiscordPayload(message: DiscordMessage): DiscordPayload {
  const label = message.backToNormal ? "Back to normal" : SEVERITY_WORD[message.severity];
  const text = `[${label}] ${message.summary}${message.detail ? ` - ${message.detail}` : ""}`;
  const content = text.length > DISCORD_CONTENT_MAX ? `${text.slice(0, DISCORD_CONTENT_MAX - 3)}...` : text;
  return { username: DISCORD_USERNAME, content, allowed_mentions: { parse: [] } };
}

export const DISCORD_TEST_MESSAGE: DiscordMessage = {
  severity: "INFO",
  summary: "This is a test message from IMAdventist Events. Alerts will appear in this channel.",
};

/** The group a stored alert key belongs to (a "system." key from the alert scan). */
export function discordGroupForAlertKey(key: string): DiscordGroup {
  return key.startsWith("system.backup.") ? "backups" : "site-health";
}

/** Fixed words for what a Discord attempt came to. Never the address. */
export type DiscordTestResult =
  | { state: "delivered"; message: string }
  | { state: "refused"; status: number; message: string }
  | { state: "unreachable"; message: string }
  | { state: "not-connected"; message: string };

export function describeDiscordAttempt(attempt: { delivered: boolean; status?: number | null }): DiscordTestResult {
  if (attempt.delivered) return { state: "delivered", message: "Delivered. Look for the test line in your Discord channel." };
  if (typeof attempt.status === "number") {
    return { state: "refused", status: attempt.status, message: `Discord refused it (status ${attempt.status}). Check the address, or make a new webhook in Discord.` };
  }
  return { state: "unreachable", message: "Could not reach Discord. Try again in a minute." };
}

/* ---------- Host job heartbeats to messages ---------- */

/** What the heartbeat route does about one host job report. `resolvePrefix` clears earlier problems of the same kind. */
export type HostJobDiscordPlan = {
  group: DiscordGroup;
  key: string;
  message: DiscordMessage;
  /** Minutes before the same problem is sent again. `null` means once only (a one-time notice). */
  repeatMinutes: number | null;
} | { resolvePrefix: string };

/** The "once only" repeat window: ten years. */
export const ONCE_ONLY_REPEAT_MINUTES = 10 * 365 * 24 * 60;


const AUTODEPLOY_KEY = "host.autodeploy.";
const FAILURE_MESSAGES: Record<string, { severity: DiscordMessageSeverity; summary: string; repeatMinutes: number }> = {
  "deploy-failed": { severity: "URGENT", summary: "A deploy failed. The live version was not replaced, or was put back.", repeatMinutes: 360 },
  "failed-commit-held": { severity: "URGENT", summary: "A version that failed to deploy is being held. It will not be tried again until a newer version is published.", repeatMinutes: 720 },
  "fast-forward-failed": { severity: "URGENT", summary: "The server could not move to the new version, so nothing was deployed.", repeatMinutes: 360 },
  "fetch-failed": { severity: "WATCH", summary: "The server could not fetch the latest version from GitHub. It tries again every 2 minutes.", repeatMinutes: 180 },
  "no-owner": { severity: "URGENT", summary: "The server's site folder has no known owner, so auto-deploy cannot run.", repeatMinutes: 720 },
};

type HeartbeatLike = { job: string; outcome: "SUCCEEDED" | "FAILED"; summary: Record<string, unknown> };

function count(summary: Record<string, unknown>, name: string): number | null {
  const value = summary[name];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function countsText(parts: [string, number | null][]): string | undefined {
  const text = parts.filter((part): part is [string, number] => part[1] !== null).map(([label, value]) => `${value} ${label}`).join(", ");
  return text || undefined;
}

const SHORT_VERSION = /^[0-9a-f]{7,12}$/;

/**
 * Turns one accepted host job heartbeat into at most one Discord message plan. `null` means nothing to say (the
 * normal 2-minute `up-to-date` and `outside-window` runs). Only fixed words, counts and a short version id.
 */
export function planHostJobMessage(heartbeat: HeartbeatLike, now = new Date()): HostJobDiscordPlan | null {
  const { job, summary } = heartbeat;
  const result = typeof summary.result === "string" ? summary.result : "";
  const version = typeof summary.version === "string" && SHORT_VERSION.test(summary.version) ? summary.version : null;

  if (job === SERVER_AUTODEPLOY_JOB) {
    if (result === "deployed") {
      return {
        group: "deploys",
        key: `notice.deploy.deployed.${version ?? "unknown"}`,
        message: { severity: "INFO", summary: version ? `Deployed version ${version}.` : "A new version was deployed." },
        repeatMinutes: version ? null : 60,
      };
    }
    const failure = FAILURE_MESSAGES[result];
    if (failure) {
      return { group: "deploys", key: `${AUTODEPLOY_KEY}${result}`, message: { severity: failure.severity, summary: failure.summary }, repeatMinutes: failure.repeatMinutes };
    }
    // up-to-date, outside-window and image-pending are quiet. A clean run clears earlier problems so the next one is sent at once.
    return { resolvePrefix: AUTODEPLOY_KEY };
  }

  if (job === SERVER_PREDEPLOY_BACKUP_JOB) {
    if (result === "failed") {
      return {
        group: "deploys",
        key: `notice.predeploy.failed.${version ?? "unknown"}`,
        message: { severity: "URGENT", summary: `The database copy before ${version ? `version ${version}` : "a deploy"} failed. Nothing was changed.` },
        repeatMinutes: 60,
      };
    }
    if (result === "skipped") {
      return {
        group: "deploys",
        key: `notice.predeploy.skipped.${version ?? "unknown"}`,
        message: { severity: "WATCH", summary: `The database copy before ${version ? `version ${version}` : "a deploy"} was skipped on purpose.` },
        repeatMinutes: 60,
      };
    }
    return null;
  }

  if (job === SERVER_RESTORE_DRILL_JOB || job === SERVER_LOAD_REHEARSAL_JOB) {
    const drill = job === SERVER_RESTORE_DRILL_JOB;
    const noun = drill ? "restore drill" : "load rehearsal";
    const passed = result === "passed";
    if (!passed && result !== "failed") return null;
    const detail = countsText(
      drill
        ? [["minutes", count(summary, "minutes")], ["checks run", count(summary, "checks")], ["checks failed", count(summary, "failed")]]
        : [["minutes", count(summary, "minutes")], ["requests", count(summary, "requests")], ["requests failed", count(summary, "failed")]],
    );
    return {
      group: "practice-runs",
      key: `notice.practice.${drill ? "restore-drill" : "load-rehearsal"}.${now.getTime()}`,
      message: { severity: passed ? "INFO" : "URGENT", summary: `The ${noun} ${passed ? "passed" : "failed"}.`, detail },
      repeatMinutes: null,
    };
  }

  return null;
}
