import { beforeEach, describe, expect, it, vi } from "vitest";

// #2048: system alerts to a Discord channel. Synthetic data only: the address below is made up.
const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  getServerEnv: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
  recordJobRun: vi.fn(),
  writeAuditLog: vi.fn(),
  getCurrentSession: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/env", () => ({ getServerEnv: mocks.getServerEnv }));
vi.mock("@/lib/logger", () => ({ logError: mocks.logError, logWarn: mocks.logWarn, logInfo: mocks.logInfo }));
vi.mock("@/lib/request-context", () => ({ currentCorrelationId: () => "corr-1", withRequestContext: (handler: unknown) => handler }));
vi.mock("@/modules/operations/sweep-heartbeat-repository", () => ({ recordJobRun: mocks.recordJobRun }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: () => null }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));

import { openSecret } from "@/lib/secret-box";
import { dispatchAlerts, type Alert } from "@/modules/operations/alerting";
import {
  DiscordAlertSettingsError,
  getDiscordAlertSettingsView,
  postToDiscord,
  removeDiscordWebhook,
  saveDiscordGroups,
  saveDiscordWebhook,
  sendDiscordTestMessage,
} from "@/modules/operations/discord-alert-settings";
import {
  ALL_DISCORD_GROUPS_ON,
  buildDiscordPayload,
  checkDiscordWebhookAddress,
  describeDiscordAttempt,
  discordGroupForAlertKey,
  ONCE_ONLY_REPEAT_MINUTES,
  planHostJobMessage,
  webhookLast4,
} from "@/modules/operations/discord-alerts-domain";
import { assessBackupAlerts, rehearsalPassedAlert } from "@/modules/operations/backup-alerts-domain";
import { parseHostJobHeartbeat } from "@/modules/operations/host-job-heartbeat";
import type { BackupStatus } from "@/modules/operations/backup-status";
import { DELETE, PATCH, PUT } from "@/app/api/admin/platform-settings/discord-alerts/route";
import { POST as TEST_POST } from "@/app/api/admin/platform-settings/discord-alerts/test/route";

const ADDRESS = "https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz0123456789ABCD";
const now = new Date("2026-11-19T12:00:00.000Z");

type Row = Record<string, unknown>;

/** An in-memory stand-in for the one platform settings row and the tables the code touches. */
function database(initial: Row | null = null) {
  let row: Row | null = initial;
  const alertRows = new Map<string, Row>();
  const tx = {
    platformSettings: {
      upsert: vi.fn(async ({ update, create }: { update: Row; create: Row }) => {
        row = row ? { ...row, ...update } : { ...create };
        return row;
      }),
    },
  };
  const prisma = {
    $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    platformSettings: {
      findUnique: vi.fn(async () => (row ? { ...row } : null)),
      update: vi.fn(async ({ data }: { data: Row }) => {
        row = { ...(row ?? {}), ...data };
        return row;
      }),
    },
    user: { findUnique: vi.fn(async () => ({ displayName: "Synthetic Admin" })) },
    alertNotification: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) => alertRows.get(where.key) ?? null),
      upsert: vi.fn(async ({ where, create, update }: { where: { key: string }; create: Row; update: Row }) => {
        alertRows.set(where.key, { ...(alertRows.get(where.key) ?? create), ...(alertRows.has(where.key) ? update : {}) });
        return {};
      }),
      updateMany: vi.fn(async () => ({ count: 0 })),
      findMany: vi.fn(async () => []),
    },
  };
  mocks.getPrisma.mockReturnValue(prisma);
  return { prisma, tx, row: () => row };
}

const okFetch = () => vi.fn(async () => new Response(null, { status: 204 }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getServerEnv.mockReturnValue({
    SECRET_ENCRYPTION_KEY: "a-synthetic-sign-in-key-of-adequate-length",
    ALERT_WEBHOOK_URL: undefined,
    ALERT_REPEAT_MINUTES: 60,
  });
  mocks.recordJobRun.mockResolvedValue(undefined);
  mocks.writeAuditLog.mockResolvedValue({});
});

describe("the address check", () => {
  it.each([
    ADDRESS,
    ADDRESS.replace("discord.com", "discordapp.com"),
    ADDRESS.replace("discord.com", "ptb.discord.com"),
    ADDRESS.replace("discord.com", "canary.discord.com"),
    ADDRESS.replace("discord.com", "ptb.discordapp.com"),
    `  ${ADDRESS}  `,
  ])("accepts %s", (address) => {
    expect(checkDiscordWebhookAddress(address)).toMatchObject({ ok: true });
  });

  it.each([
    "",
    "not a url",
    ADDRESS.replace("https", "http"),
    ADDRESS.replace("discord.com", "example.com"),
    ADDRESS.replace("discord.com", "discord.com.evil.test"),
    ADDRESS.replace("discord.com", "evil.test/x#discord.com"),
    `${ADDRESS}?wait=true`,
    `${ADDRESS}/extra`,
    ADDRESS.replace("discord.com", "discord.com:8443"),
    ADDRESS.replace("https://", "https://user:pass@"),
    ADDRESS.replace("/api/webhooks/", "/api/hooks/"),
    "https://discord.com/api/webhooks/abc/def",
    "https://hooks.slack.test/services/T000/B000/XXXX",
  ])("rejects %s with a plain message", (address) => {
    const checked = checkDiscordWebhookAddress(address);
    expect(checked.ok).toBe(false);
    if (!checked.ok) {
      expect(checked.message).toMatch(/not a Discord channel webhook address/);
      expect(checked.message).not.toContain(address.trim() || "zzz-never");
    }
  });

  it("rejects values that are not text", () => {
    expect(checkDiscordWebhookAddress(null).ok).toBe(false);
    expect(checkDiscordWebhookAddress({ href: ADDRESS }).ok).toBe(false);
  });

  it("shows only the last 4 characters", () => {
    expect(webhookLast4(ADDRESS)).toBe("ABCD");
  });
});

describe("the message", () => {
  it("is Discord format, capped at 2000 characters, with mentions switched off and a fixed name", () => {
    const payload = buildDiscordPayload({ severity: "URGENT", summary: "x".repeat(5000), detail: "@everyone <@123>" });
    expect(payload.content.length).toBeLessThanOrEqual(2000);
    expect(payload.allowed_mentions).toEqual({ parse: [] });
    expect(payload.username).toBe("IMAdventist Events");
    expect(Object.keys(payload).sort()).toEqual(["allowed_mentions", "content", "username"]);
  });

  it("reads plainly", () => {
    expect(buildDiscordPayload({ severity: "URGENT", summary: "Email delivery is falling behind", detail: "31 messages are due" }).content)
      .toBe("[URGENT] Email delivery is falling behind - 31 messages are due");
    expect(buildDiscordPayload({ severity: "INFO", summary: "Email delivery is keeping up again.", backToNormal: true }).content)
      .toBe("[Back to normal] Email delivery is keeping up again.");
  });

  it("describes a test in words", () => {
    expect(describeDiscordAttempt({ delivered: true }).state).toBe("delivered");
    expect(describeDiscordAttempt({ delivered: false, status: 404 })).toMatchObject({ state: "refused", status: 404 });
    expect(describeDiscordAttempt({ delivered: false, status: 404 }).message).toContain("status 404");
    expect(describeDiscordAttempt({ delivered: false, status: null }).state).toBe("unreachable");
  });
});

describe("saving, reading and removing the address", () => {
  it("seals the address, and it opens again with the same purpose", async () => {
    const db = database();
    await saveDiscordWebhook(ADDRESS, "admin-1", now);
    const stored = String(db.row()?.sealedDiscordWebhook);
    expect(stored).not.toContain("discord");
    expect(stored).not.toContain("abcdefghij");
    expect(openSecret(stored, "discord-alert-webhook")).toBe(ADDRESS);
    expect(() => openSecret(stored, "another-purpose")).toThrow();
    expect(db.row()?.discordWebhookLast4).toBe("ABCD");
  });

  it("never gives the address back, in the view, the audit rows or the logs", async () => {
    database();
    const view = await saveDiscordWebhook(ADDRESS, "admin-1", now);
    expect(view).toMatchObject({ connected: true, last4: "ABCD", setByName: "Synthetic Admin" });
    const everything = JSON.stringify([view, await getDiscordAlertSettingsView(), mocks.writeAuditLog.mock.calls, mocks.logWarn.mock.calls, mocks.logError.mock.calls, mocks.logInfo.mock.calls]);
    expect(everything).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789");
    expect(everything).not.toContain("123456789012345678");
    expect(everything).not.toContain("sealedDiscordWebhook\":\"v");
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "DISCORD_ALERTS_ADDRESS_SET", actorUserId: "admin-1" }), expect.anything());
    expect(mocks.writeAuditLog.mock.calls[0][0].metadata).toBeUndefined();
  });

  it("refuses a bad address and writes nothing", async () => {
    const db = database();
    await expect(saveDiscordWebhook("https://example.com/x", "admin-1", now)).rejects.toBeInstanceOf(DiscordAlertSettingsError);
    expect(db.tx.platformSettings.upsert).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("refuses with a plain error when the server has no encryption key", async () => {
    database();
    mocks.getServerEnv.mockReturnValue({});
    await expect(saveDiscordWebhook(ADDRESS, "admin-1", now)).rejects.toThrow(/encryption key/);
  });

  it("removes the address and audits the action only", async () => {
    const db = database();
    await saveDiscordWebhook(ADDRESS, "admin-1", now);
    const view = await removeDiscordWebhook("admin-1");
    expect(view.connected).toBe(false);
    expect(db.row()?.sealedDiscordWebhook).toBeNull();
    expect(mocks.writeAuditLog).toHaveBeenLastCalledWith(expect.objectContaining({ action: "DISCORD_ALERTS_ADDRESS_REMOVED" }), expect.anything());
  });

  it("audits a switch change with the switches, not the address", async () => {
    database();
    await saveDiscordWebhook(ADDRESS, "admin-1", now);
    await saveDiscordGroups({ ...ALL_DISCORD_GROUPS_ON, deploys: false }, "admin-1");
    const call = mocks.writeAuditLog.mock.calls.at(-1)![0];
    expect(call.action).toBe("DISCORD_ALERTS_GROUPS_CHANGED");
    expect(JSON.stringify(call)).not.toContain("webhooks");
  });
});

describe("posting", () => {
  async function connected(extra: Row = {}) {
    const db = database();
    await saveDiscordWebhook(ADDRESS, "admin-1", now);
    Object.assign(db.row()!, extra);
    return db;
  }

  it("posts to the saved address and records the delivery time", async () => {
    const db = await connected();
    const fetchImpl = okFetch();
    const result = await postToDiscord("site-health", { severity: "URGENT", summary: "Email delivery is falling behind" }, { fetchImpl, now });
    expect(result).toMatchObject({ attempted: true, delivered: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(ADDRESS);
    expect(JSON.parse(String(init.body)).allowed_mentions).toEqual({ parse: [] });
    expect(db.row()?.discordLastDeliveredAt).toEqual(now);
  });

  it("sends nothing when the group is switched off, or no address is saved", async () => {
    await connected({ discordAlertDeploys: false });
    const fetchImpl = okFetch();
    expect(await postToDiscord("deploys", { severity: "INFO", summary: "x" }, { fetchImpl })).toEqual({ attempted: false, delivered: false });
    expect(await postToDiscord("site-health", { severity: "URGENT", summary: "x" }, { fetchImpl })).toMatchObject({ delivered: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    database();
    const other = okFetch();
    expect(await postToDiscord("site-health", { severity: "URGENT", summary: "x" }, { fetchImpl: other })).toEqual({ attempted: false, delivered: false });
    expect(other).not.toHaveBeenCalled();
  });

  it("never throws when Discord refuses or cannot be reached, and logs no address", async () => {
    const db = await connected();
    const refused = vi.fn(async () => new Response("no", { status: 404 }));
    expect(await postToDiscord("site-health", { severity: "URGENT", summary: "x" }, { fetchImpl: refused, now })).toMatchObject({ attempted: true, delivered: false, status: 404 });
    expect(db.row()?.discordLastFailedAt).toEqual(now);
    const down = vi.fn(async () => { throw new Error(`connect failed ${ADDRESS}`); });
    expect(await postToDiscord("site-health", { severity: "URGENT", summary: "x" }, { fetchImpl: down, now })).toMatchObject({ delivered: false, status: null });
    expect(JSON.stringify(mocks.logWarn.mock.calls)).not.toContain("123456789012345678");
  });

  it("never throws when the stored value cannot be opened", async () => {
    await connected({ sealedDiscordWebhook: "garbage" });
    expect(await postToDiscord("site-health", { severity: "URGENT", summary: "x" }, { fetchImpl: okFetch() })).toEqual({ attempted: false, delivered: false });
  });

  it("answers a test in words, whatever the switches say", async () => {
    await connected({ discordAlertSiteHealth: false, discordAlertDeploys: false, discordAlertBackups: false, discordAlertPracticeRuns: false });
    expect((await sendDiscordTestMessage("admin-1", { fetchImpl: okFetch(), now })).state).toBe("delivered");
    expect(await sendDiscordTestMessage("admin-1", { fetchImpl: vi.fn(async () => new Response("", { status: 401 })), now })).toMatchObject({ state: "refused", status: 401 });
    expect((await sendDiscordTestMessage("admin-1", { fetchImpl: vi.fn(async () => { throw new Error("down"); }), now })).state).toBe("unreachable");
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "DISCORD_ALERTS_TEST_SENT" }));
    database();
    expect((await sendDiscordTestMessage("admin-1", { fetchImpl: okFetch() })).state).toBe("not-connected");
  });
});

describe("dispatching alerts to Discord", () => {
  const alert: Alert = {
    key: "system.outbox.messages-failed",
    severity: "URGENT",
    summary: "2 messages gave up after every retry",
    detail: "Somebody did not receive a confirmation.",
    webhookOnlyDetail: "Jane Synthetic <jane@example.test>",
    context: { failedMessages: 2 },
  };

  it("drops webhookOnlyDetail and context from Discord, and keeps the env webhook as it was", async () => {
    database();
    await saveDiscordWebhook(ADDRESS, "admin-1", now);
    mocks.getServerEnv.mockReturnValue({ SECRET_ENCRYPTION_KEY: "a-synthetic-sign-in-key-of-adequate-length", ALERT_WEBHOOK_URL: "https://hooks.test/imsda", ALERT_REPEAT_MINUTES: 60 });
    const fetchImpl = okFetch();
    const result = await dispatchAlerts([alert], { now, fetchImpl });
    expect(result.sent).toEqual([alert]);
    const calls = fetchImpl.mock.calls as unknown as [string, RequestInit][];
    const env = calls.find(([url]) => url === "https://hooks.test/imsda")!;
    const discord = calls.find(([url]) => url === ADDRESS)!;
    expect(String(env[1].body)).toContain("jane@example.test");
    expect(String(discord[1].body)).not.toContain("Jane");
    expect(String(discord[1].body)).not.toContain("example.test");
    expect(String(discord[1].body)).not.toContain("failedMessages");
  });

  it("respects the group switch", async () => {
    database();
    await saveDiscordWebhook(ADDRESS, "admin-1", now);
    await saveDiscordGroups({ ...ALL_DISCORD_GROUPS_ON, "site-health": false }, "admin-1");
    const fetchImpl = okFetch();
    await dispatchAlerts([alert], { now, fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not let a Discord failure break the run, and retries only when nothing else delivered", async () => {
    database();
    await saveDiscordWebhook(ADDRESS, "admin-1", now);
    const refuse = vi.fn(async () => new Response("", { status: 500 }));
    const result = await dispatchAlerts([alert], { now, fetchImpl: refuse });
    expect(result.undelivered).toEqual([alert]);
    // With the env webhook delivering, the Discord failure does not count against the alert.
    mocks.getServerEnv.mockReturnValue({ SECRET_ENCRYPTION_KEY: "a-synthetic-sign-in-key-of-adequate-length", ALERT_WEBHOOK_URL: "https://hooks.test/imsda", ALERT_REPEAT_MINUTES: 60 });
    const mixed = vi.fn(async (url: string) => new Response(null, { status: url === ADDRESS ? 500 : 200 }));
    const second = await dispatchAlerts([alert], { now, fetchImpl: mixed as unknown as typeof fetch });
    expect(second.sent).toEqual([alert]);
  });

  it("keeps the repeat window: the same condition is not sent again within it", async () => {
    database();
    await saveDiscordWebhook(ADDRESS, "admin-1", now);
    const fetchImpl = okFetch();
    await dispatchAlerts([alert], { now, fetchImpl });
    await dispatchAlerts([alert], { now: new Date(now.getTime() + 10 * 60_000), fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("sends the other groups to Discord only, never to the env webhook", async () => {
    database();
    await saveDiscordWebhook(ADDRESS, "admin-1", now);
    mocks.getServerEnv.mockReturnValue({ SECRET_ENCRYPTION_KEY: "a-synthetic-sign-in-key-of-adequate-length", ALERT_WEBHOOK_URL: "https://hooks.test/imsda", ALERT_REPEAT_MINUTES: 60 });
    const fetchImpl = okFetch();
    await dispatchAlerts([{ key: "notice.deploy.deployed.abc1234", severity: "INFO", group: "deploys", summary: "Deployed version abc1234." }], { now, fetchImpl, repeatMinutes: ONCE_ONLY_REPEAT_MINUTES });
    expect((fetchImpl.mock.calls as unknown as [string][]).map(([url]) => url)).toEqual([ADDRESS]);
  });

  it("sends 'deployed' once per version, not on every run", async () => {
    database();
    await saveDiscordWebhook(ADDRESS, "admin-1", now);
    const fetchImpl = okFetch();
    const plan = planHostJobMessage({ job: "server-autodeploy", outcome: "SUCCEEDED", summary: { result: "deployed", version: "abc1234" } }, now);
    if (!plan || "resolvePrefix" in plan) throw new Error("expected a message");
    const send = (at: Date) => dispatchAlerts([{ key: plan.key, severity: plan.message.severity, group: plan.group, summary: plan.message.summary }], { now: at, fetchImpl, repeatMinutes: plan.repeatMinutes ?? ONCE_ONLY_REPEAT_MINUTES });
    await send(now);
    await send(new Date(now.getTime() + 2 * 60_000));
    await send(new Date(now.getTime() + 30 * 24 * 60 * 60_000));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.content).toContain("Deployed version abc1234");
  });
});

describe("host job heartbeats to messages", () => {
  const beat = (job: string, outcome: "SUCCEEDED" | "FAILED", summary: Record<string, unknown>) => planHostJobMessage({ job, outcome, summary }, now);

  it("is quiet on the normal 2-minute runs, and clears earlier problems", () => {
    for (const result of ["up-to-date", "outside-window", "image-pending"]) {
      expect(beat("server-autodeploy", "SUCCEEDED", { result })).toEqual({ resolvePrefix: "host.autodeploy." });
    }
  });

  it("maps each deploy failure to the deploys group", () => {
    for (const result of ["deploy-failed", "failed-commit-held", "fast-forward-failed", "fetch-failed", "no-owner"]) {
      expect(beat("server-autodeploy", "FAILED", { result })).toMatchObject({ group: "deploys", key: `host.autodeploy.${result}` });
    }
    const held = beat("server-autodeploy", "FAILED", { result: "failed-commit-held" });
    expect(held && "repeatMinutes" in held && held.repeatMinutes).toBeGreaterThanOrEqual(360);
  });

  it("names the short version for a deploy, and only a valid one", () => {
    expect(beat("server-autodeploy", "SUCCEEDED", { result: "deployed", version: "0a1b2c3" })).toMatchObject({ key: "notice.deploy.deployed.0a1b2c3", repeatMinutes: null });
    const bad = beat("server-autodeploy", "SUCCEEDED", { result: "deployed", version: "Jane Doe" });
    expect(JSON.stringify(bad)).not.toContain("Jane");
  });

  it("covers the database copy before a deploy", () => {
    expect(beat("server-predeploy-backup", "FAILED", { result: "failed", version: "0a1b2c3" })).toMatchObject({ group: "deploys", message: { severity: "URGENT" } });
    expect(beat("server-predeploy-backup", "SUCCEEDED", { result: "skipped", version: "0a1b2c3" })).toMatchObject({ group: "deploys", message: { severity: "WATCH" } });
    expect(beat("server-predeploy-backup", "SUCCEEDED", { result: "copied", version: "0a1b2c3" })).toBeNull();
  });

  it("reports a restore drill and a load rehearsal with counts and minutes only", () => {
    expect(beat("server-restore-drill", "SUCCEEDED", { result: "passed", minutes: 42, checks: 12, failed: 0 })).toMatchObject({
      group: "practice-runs",
      message: { severity: "INFO", summary: "The restore drill passed.", detail: "42 minutes, 12 checks run, 0 checks failed" },
    });
    expect(beat("server-load-rehearsal", "FAILED", { result: "failed", minutes: 15, requests: 5000, failed: 120 })).toMatchObject({
      message: { severity: "URGENT", summary: "The load rehearsal failed." },
    });
    expect(beat("server-docker-cleanup", "SUCCEEDED", { result: "cleaned" })).toBeNull();
  });

  it("is accepted by the heartbeat schema, strictly", () => {
    const ok = (value: unknown) => parseHostJobHeartbeat(JSON.stringify(value)) !== null;
    expect(ok({ job: "server-autodeploy", outcome: "SUCCEEDED", summary: { result: "deployed", version: "0a1b2c3" } })).toBe(true);
    expect(ok({ job: "server-autodeploy", outcome: "SUCCEEDED", summary: { result: "deployed", version: "not-a-sha" } })).toBe(false);
    expect(ok({ job: "server-predeploy-backup", outcome: "FAILED", summary: { result: "failed", version: "0a1b2c3" } })).toBe(true);
    expect(ok({ job: "server-predeploy-backup", outcome: "SUCCEEDED", summary: { result: "skipped" } })).toBe(true);
    expect(ok({ job: "server-predeploy-backup", outcome: "SUCCEEDED", summary: { result: "failed" } })).toBe(false);
    expect(ok({ job: "server-restore-drill", outcome: "SUCCEEDED", summary: { result: "passed", minutes: 3, checks: 4, failed: 0 } })).toBe(true);
    expect(ok({ job: "server-restore-drill", outcome: "SUCCEEDED", summary: { result: "failed" } })).toBe(false);
    expect(ok({ job: "server-load-rehearsal", outcome: "FAILED", summary: { result: "failed", requests: 10, name: "x" } })).toBe(false);
  });
});

describe("backup alerts", () => {
  const status = (over: Partial<BackupStatus>): BackupStatus => ({
    status: "ok", stale: false, lastSuccessAt: now.toISOString(), lastRunAt: now.toISOString(), lastRunOk: true, dumpBytes: 1, assetsBytes: 1,
    offsiteOk: true, lastOffsiteSuccessAt: now.toISOString(), offsiteStopped: false, lastRehearsalAt: now.toISOString(), lastRehearsalOk: true,
    lastRehearsalSuccessAt: now.toISOString(), rehearsalOverdue: false, needsAttention: false, ...over,
  });

  it("is quiet when all is well", () => {
    expect(assessBackupAlerts({ status: status({}), offsiteDatabase: "ok" })).toEqual([]);
  });

  it("raises each backup problem in the backups group under a system.backup key", () => {
    const keys = (alerts: Alert[]) => alerts.map((alert) => alert.key);
    expect(keys(assessBackupAlerts({ status: status({ stale: true, status: "stale" }), offsiteDatabase: null }))).toEqual(["system.backup.nightly-overdue"]);
    expect(keys(assessBackupAlerts({ status: status({ status: "failing", lastRunOk: false }), offsiteDatabase: null }))).toEqual(["system.backup.nightly-failed"]);
    expect(keys(assessBackupAlerts({ status: null, offsiteDatabase: "stale" }))).toEqual(["system.backup.offsite-overdue"]);
    expect(keys(assessBackupAlerts({ status: status({ offsiteStopped: true }), offsiteDatabase: null }))).toEqual(["system.backup.offsite-overdue"]);
    expect(keys(assessBackupAlerts({ status: status({ lastRehearsalOk: false }), offsiteDatabase: null }))).toEqual(["system.backup.rehearsal-failed"]);
    expect(keys(assessBackupAlerts({ status: status({ rehearsalOverdue: true }), offsiteDatabase: null }))).toEqual(["system.backup.rehearsal-overdue"]);
    expect(assessBackupAlerts({ status: null, offsiteDatabase: "missing" }).every((alert) => alert.group === "backups")).toBe(true);
    expect(discordGroupForAlertKey("system.backup.nightly-failed")).toBe("backups");
    expect(discordGroupForAlertKey("system.payments.failed")).toBe("site-health");
  });

  it("announces a recent passed restore check once, and not an old one", () => {
    expect(rehearsalPassedAlert(status({}), now)).toMatchObject({ group: "backups", severity: "INFO" });
    expect(rehearsalPassedAlert(status({ lastRehearsalAt: "2026-11-10T00:00:00.000Z" }), now)).toBeNull();
    expect(rehearsalPassedAlert(status({ lastRehearsalOk: false }), now)).toBeNull();
  });
});

describe("who can change the settings", () => {
  const request = (method: string, body?: unknown) =>
    new Request("http://localhost/api/admin/platform-settings/discord-alerts", { method, body: body === undefined ? undefined : JSON.stringify(body) });
  const call = (handler: unknown, req: Request) => (handler as (request: Request) => Promise<Response>)(req);

  it.each([
    ["no one signed in", null],
    ["a user without the system administrator role", { id: "staff-1", globalRole: "NONE" }],
    ["an event administrator", { id: "staff-2", globalRole: "EVENT_ADMIN" }],
  ])("refuses %s on save, switches, remove and test", async (_label, user) => {
    const db = database();
    mocks.getCurrentSession.mockResolvedValue({ user });
    for (const response of [
      await call(PUT, request("PUT", { address: ADDRESS })),
      await call(PATCH, request("PATCH", { groups: ALL_DISCORD_GROUPS_ON })),
      await call(DELETE, request("DELETE")),
      await call(TEST_POST, request("POST", {})),
    ]) {
      expect(response.status).toBe(403);
    }
    expect(db.tx.platformSettings.upsert).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("lets a system administrator save, and the response never carries the address", async () => {
    database();
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "admin-1", globalRole: "SYSTEM_ADMIN" } });
    const saved = await call(PUT, request("PUT", { address: ADDRESS }));
    expect(saved.status).toBe(200);
    const text = await saved.text();
    expect(text).not.toContain("123456789012345678");
    expect(JSON.parse(text).settings).toMatchObject({ connected: true, last4: "ABCD" });
    const refused = await call(PUT, request("PUT", { address: "https://example.com" }));
    expect(refused.status).toBe(400);
    expect(await refused.text()).not.toContain("example.com");
    const extra = await call(PUT, request("PUT", { address: ADDRESS, other: 1 }));
    expect(extra.status).toBe(400);
  });
});
