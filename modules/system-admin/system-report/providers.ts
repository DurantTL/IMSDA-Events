import "server-only";

import { getPrisma } from "@/lib/prisma";
import { logError } from "@/lib/logger";
import { getReleaseIdentity, getReleaseTimes } from "@/lib/release";
import { getMessageFileStorageUsage } from "@/modules/communications/message-file-usage";
import { conferenceToday } from "@/modules/calendar/repository";
import { reconcileRegistrationLedger } from "@/modules/ledger/reconciliation";
import { getEmailAvailability } from "@/integrations/email/provider";
import { isGoogleSignInConfigured } from "@/integrations/oauth/google";
import { isBreachCheckEnabled } from "@/modules/access/password-breach";
import { checkDatabaseLiveness } from "@/modules/operations/database-liveness";
import { readDiskSpace } from "@/modules/operations/disk-space";
import {
  ALERT_SCAN_JOB,
  ALERT_WEBHOOK_DELIVERY_JOB,
  APPLE_PAY_FILE_REACHABILITY_JOB,
  BREACH_SERVICE_REACHABILITY_JOB,
  CALENDAR_FEED_REACHABILITY_JOB,
  CALENDAR_FEED_REFRESH_JOB,
  CLASS_WAITLIST_SWEEP_JOB,
  DEADLINE_REMINDER_PREPARATION_JOB,
  EMAIL_REACHABILITY_JOB,
  GENERAL_LINK_EXPIRY_JOB,
  GOOGLE_KEYS_REACHABILITY_JOB,
  HEALTH_SNAPSHOT_SWEEP_JOB,
  HONOR_WATCH_SUMMARIES_JOB,
  INSTRUCTOR_CLASS_EMAILS_JOB,
  LOCATION_WAITLIST_DIGEST_JOB,
  MESSAGE_FILE_CLEANUP_JOB,
  RETENTION_CLEANUP_JOB,
  SQUARE_REACHABILITY_JOB,
  SWEEP_STEP_STALE_AFTER_MS,
  SERVER_AUTODEPLOY_JOB,
  SERVER_AUTODEPLOY_STALE_AFTER_MS,
  SERVER_DOCKER_CLEANUP_JOB,
  SERVER_DOCKER_CLEANUP_STALE_AFTER_MS,
  SERVER_RUNTIME_GUARD_JOB,
  SERVER_RUNTIME_GUARD_STALE_AFTER_MS,
} from "@/modules/operations/sweep-heartbeat";
import { getJobRun } from "@/modules/operations/sweep-heartbeat-repository";
import { getSquareConfiguration } from "@/modules/payments/square-config";
import { getOperationalHealth } from "@/modules/operations/repository";
import { getAnalyticsSummary } from "@/modules/public-metrics/repository";
import { getAdminAttentionSummary } from "@/modules/system-admin/attention-repository";
import { buildEnvironmentStatus, type EnvironmentStatus } from "@/modules/system-admin/environment-status";
import { buildHealthSignals, type HealthSignal } from "@/modules/system-admin/health-model";
import type { AutomaticReadinessRow } from "@/modules/system-admin/readiness-checks";
import { getSystemReadiness } from "@/modules/system-admin/readiness-repository";
import { getSystemHealth } from "@/modules/system-admin/repository";
import { runPricingSelfTest } from "./pricing-self-test";
import { countPublicSubmissionsSince, readOpenRegistrationEvents, readUnreleasedHoldCounts } from "./registration-reads";
import { openWithoutFormFields, pricingSelfTestFields, registrationsReceivedFields, unreleasedHoldsFields } from "./registration-signals";
import { buildMoneyProviders } from "./money-providers";
import {
  alertDeliveryFields,
  alertScanFields,
  autodeployFields,
  calendarRefreshFields,
  classWaitlistFields,
  deadlineReminderFields,
  diskFields,
  dockerCleanupFields,
  generalLinkExpiryFields,
  healthSnapshotFields,
  honorWatchSummaryFields,
  instructorClassEmailFields,
  locationWaitlistDigestFields,
  messageFileCleanupFields,
  reachabilityFields,
  retentionCleanupFields,
  runtimeGuardFields,
  type ReachabilityKind,
} from "./job-signals";
import { isAlertDeliveryConfigured } from "@/modules/operations/alerting";
import { getServerEnv } from "@/lib/env";
import { getOffsiteBackups } from "@/modules/operations/offsite-backups-reader";
import { offsiteBackupFields } from "./backup-signals";
import { securityCheckFields } from "./security-check-signal";
import { buildCommunicationsProviders } from "./communications-providers";
import { buildEventOpsProviders } from "./event-ops-providers";
import { buildSelfTestProviders } from "./self-test-providers";
import { unavailableSignal, type SectionKey, type Signal, type SignalMeta, type SignalState } from "./model";
import { buildEmailBackupProviders } from "./email-backup-providers";
import { buildNoticeProviders } from "./notice-providers";

/**
 * The System report's signal providers (#1357). Each provider wraps ONE existing module computation and turns it into
 * signals; none of them measures anything itself. A provider never throws: a read that fails becomes "unavailable" rows
 * stamped "Tried <time>", so one failing source never breaks the page. To add a check (#1359), append a provider to
 * `systemReportProviders` below and, if it is a new area, a section to `SECTION_DEFINITIONS` in `model.ts`.
 */

export type Read<T> = { ok: true; value: T; readAt: Date } | { ok: false; readAt: Date };

/** One report run's shared reads, so a computation several sections draw on runs once. It never throws. */
export type ReportContext = {
  now: Date;
  once<T>(key: string, load: () => Promise<T>): Promise<Read<T>>;
};

export function createReportContext(now: Date): ReportContext {
  const cache = new Map<string, Promise<Read<unknown>>>();
  return {
    now,
    once<T>(key: string, load: () => Promise<T>) {
      let entry = cache.get(key) as Promise<Read<T>> | undefined;
      if (!entry) {
        entry = load().then(
          (value): Read<T> => ({ ok: true, value, readAt: new Date() }),
          (error): Read<T> => {
            logError("System report could not read a source", error, { source: key });
            return { ok: false, readAt: new Date() };
          },
        );
        cache.set(key, entry);
      }
      return entry;
    },
  };
}

export type SignalProvider = {
  section: SectionKey;
  /** The rows this provider always answers for, so a failed read still shows each one as unavailable. */
  signals: readonly SignalMeta[];
  load(now: Date, ctx?: ReportContext): Promise<Signal[]>;
};

type Reader = (ctx: ReportContext) => Promise<Array<Partial<Signal> & Pick<Signal, "key" | "state" | "resultText">>>;

/**
 * Builds a provider whose `load` cannot fail. A reader that throws makes every declared row unavailable; a declared
 * row the reader did not return is unavailable too, so a row never silently disappears.
 */
export function defineProvider(section: SectionKey, metas: readonly SignalMeta[], read: Reader): SignalProvider {
  return {
    section,
    signals: metas,
    async load(now, ctx = createReportContext(now)) {
      let returned: Awaited<ReturnType<Reader>> = [];
      try {
        returned = await read(ctx);
      } catch (error) {
        logError("System report provider failed", error, { section });
      }
      const triedAt = new Date();
      return metas.map((meta): Signal => {
        const found = returned.find((signal) => signal.key === meta.key);
        if (!found) return unavailableSignal(meta, section, triedAt);
        return {
          ...meta,
          section,
          checkedAt: now.toISOString(),
          whenLabel: "Checked",
          ...found,
        } as Signal;
      });
    },
  };
}

const iso = (date: Date) => date.toISOString();

/** A source that could not be read, for one row. */
function tried<T>(read: Read<T>, reason?: string) {
  return { checkedAt: iso(read.readAt), whenLabel: "Tried", state: "unavailable" as const, resultText: reason ?? "This could not be read just now. It is not shown as healthy or as zero." };
}

/* ---------- Shared reads ---------- */

function systemHealth(ctx: ReportContext) {
  return ctx.once("system-health", () => getSystemHealth(ctx.now));
}
function attention(ctx: ReportContext) {
  return ctx.once("attention", () => getAdminAttentionSummary(ctx.now.getTime()));
}
function readiness(ctx: ReportContext) {
  return ctx.once("readiness", () => getSystemReadiness(ctx.now));
}
function environment(ctx: ReportContext) {
  return ctx.once("environment", async () => buildEnvironmentStatus(process.env));
}
function unresolvedAlertCount(ctx: ReportContext) {
  return ctx.once("alert-count", () => getPrisma().alertNotification.count({ where: { resolvedAt: null } }));
}

/** Events worth reading operational health and the ledger for: not archived, and not ended more than 30 days ago. */
const EVENT_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
function reportEvents(ctx: ReportContext) {
  return ctx.once("events", () =>
    getPrisma().event.findMany({
      where: { archivedAt: null, endsAt: { gte: new Date(ctx.now.getTime() - EVENT_LOOKBACK_MS) } },
      orderBy: { startsAt: "asc" },
      select: { id: true, name: true },
    }),
  );
}

type Settled<T> = { readAt: Date; events: Array<{ id: string; name: string }>; results: Array<{ id: string; name: string; value: T }>; failed: number };

/** One computation per event, kept as a count of the events that could not be read. */
/** At most this many events are read at once, so a long event list never opens a burst of database work. */
const EVENT_READ_CONCURRENCY = 4;

/** Runs the tasks with at most `limit` in flight, keeping order and never rejecting (like `Promise.allSettled`). */
async function settleLimited<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const index = next++;
      try {
        results[index] = { status: "fulfilled", value: await tasks[index]() };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

function perEvent<T>(ctx: ReportContext, key: string, run: (eventId: string) => Promise<T>) {
  return ctx.once<Settled<T>>(key, async () => {
    const eventsRead = await reportEvents(ctx);
    if (!eventsRead.ok) throw new Error("events could not be read");
    const settled = await settleLimited(eventsRead.value.map((event) => () => run(event.id)), EVENT_READ_CONCURRENCY);
    const results: Settled<T>["results"] = [];
    let failed = 0;
    settled.forEach((outcome, index) => {
      if (outcome.status === "fulfilled") results.push({ ...eventsRead.value[index], value: outcome.value });
      else {
        failed += 1;
        logError("System report could not read one event", outcome.reason, { source: key });
      }
    });
    return { readAt: new Date(), events: eventsRead.value, results, failed };
  });
}

const ALL_ACCESS = { finance: true, communications: true, imports: true, capacity: true };
function operational(ctx: ReportContext) {
  return perEvent(ctx, "operational-health", (eventId) => getOperationalHealth(eventId, ALL_ACCESS, ctx.now));
}
function ledger(ctx: ReportContext) {
  return perEvent(ctx, "ledger", (eventId) => reconcileRegistrationLedger(getPrisma(), { eventId }));
}

/** The existing health signals (sweep, queue, alerts, delivery), built once by `buildHealthSignals`. */
async function healthSignals(ctx: ReportContext): Promise<HealthSignal[]> {
  const [health, attentionRead, alertCount] = await Promise.all([systemHealth(ctx), attention(ctx), unresolvedAlertCount(ctx)]);
  return buildHealthSignals({
    health: health.ok ? health.value : null,
    unresolvedAlertCount: alertCount.ok ? alertCount.value : null,
    attention: attentionRead.ok ? attentionRead.value : null,
    readAt: iso(health.readAt),
  });
}

/* ---------- Mapping existing readings to signals ---------- */

const HEALTH_STATE: Record<HealthSignal["state"], SignalState> = { ok: "ok", warn: "watch", bad: "attention", unknown: "unavailable" };

/**
 * One existing health signal as a report signal. A signal whose reading was unavailable or partial can never come out
 * as OK, whatever state it carried.
 */
function fromHealthSignal(signal: HealthSignal, readAt: Date): Pick<Signal, "key" | "state" | "resultText" | "checkedAt" | "whenLabel" | "items"> {
  let state = HEALTH_STATE[signal.state];
  if (state === "ok" && signal.freshness !== "current") state = signal.freshness === "partial" ? "watch" : "unavailable";
  const whenLabel = state === "unavailable" || signal.freshness === "unavailable"
    ? "Tried"
    : signal.key === "email-sweep" ? (signal.state === "bad" && signal.observedAt && signal.label.startsWith("Failing") ? "Last failure" : "Last success") : "Checked";
  return {
    key: signal.key,
    state,
    resultText: signal.detail,
    checkedAt: state === "unavailable" || signal.freshness === "unavailable" ? iso(readAt) : signal.observedAt ?? iso(readAt),
    whenLabel,
    ...(signal.items ? { items: signal.items } : {}),
  };
}

async function pickHealth(ctx: ReportContext, keys: readonly string[]) {
  const readAt = (await systemHealth(ctx)).readAt;
  const all = await healthSignals(ctx);
  return all.filter((signal) => keys.includes(signal.key)).map((signal) => fromHealthSignal(signal, readAt));
}

const READINESS_STATE: Record<AutomaticReadinessRow["status"], SignalState> = { ok: "ok", attention: "attention", info: "info", unknown: "unavailable" };

/** One automatic readiness row. Only its key, status and summary are used: never the names it lists for follow-up. */
async function readinessRow(ctx: ReportContext, rowKey: string, signalKey: string) {
  const read = await readiness(ctx);
  if (!read.ok) return { key: signalKey, ...tried(read) };
  const row = read.value.automatic.find((candidate) => candidate.key === rowKey);
  if (!row) return { key: signalKey, ...tried(read, "This reading was not part of the readiness check.") };
  const state = READINESS_STATE[row.status];
  return {
    key: signalKey,
    state,
    resultText: row.summary,
    checkedAt: read.value.generatedAt,
    whenLabel: state === "unavailable" ? "Tried" : "Checked",
  };
}

/** The production backups xCloud writes to R2, read through the cached read-only listing (#1412). */
async function offsiteBackupRows(ctx: ReportContext) {
  const read = await ctx.once("offsite-backups", () => getOffsiteBackups());
  return offsiteBackupFields(read.ok ? read.value : null, ctx.now);
}

/* ---------- Stored job runs and connection tests ---------- */

/** A step the sweep records on `SystemJobHeartbeat`: judged stale after an hour without a success. */
async function jobRow(
  ctx: ReportContext,
  job: string,
  key: string,
  fields: (key: string, run: Awaited<ReturnType<typeof getJobRun>>, readAt: Date) => ReturnType<typeof calendarRefreshFields>,
  staleAfterMs = SWEEP_STEP_STALE_AFTER_MS,
) {
  const read = await ctx.once(`job:${job}`, () => getJobRun(job, ctx.now, staleAfterMs));
  if (!read.ok) return { key, ...tried(read, "The last run could not be read. It is not shown as healthy.") };
  return fields(key, read.value, read.readAt);
}

/** Same rule as `healthRecordsEnabled()` in modules/health-records/flag.ts, copied because tests/health-records-privacy-guards.test.ts forbids importing that module here.
 * The health records switch, read from the environment like the module does (exactly "true" is on; a failed read is off). */
function healthRecordsSwitchedOn() {
  try {
    return getServerEnv().HEALTH_RECORDS_ENABLED === true;
  } catch {
    return false;
  }
}

/** Alert delivery (#1377): recorded only when an alert is sent, so it is never judged stale. */
async function alertDeliveryRow(ctx: ReportContext, key: string) {
  let configured: boolean;
  try {
    configured = isAlertDeliveryConfigured();
  } catch {
    return { key, checkedAt: iso(ctx.now), whenLabel: "Tried", state: "unavailable" as const, resultText: "Whether this is set up could not be read." };
  }
  if (!configured) return alertDeliveryFields(key, { configured: false, run: null }, ctx.now);
  const read = await ctx.once(`job:${ALERT_WEBHOOK_DELIVERY_JOB}`, () => getJobRun(ALERT_WEBHOOK_DELIVERY_JOB, ctx.now));
  return alertDeliveryFields(key, { configured: true, run: read.ok ? read.value : null }, ctx.now);
}

/** The stored result of an on-demand connection test. Never run on page load: the Test connections button runs it. */
async function reachabilityRow(ctx: ReportContext, kind: ReachabilityKind, key: string, job: string, isConfigured: () => boolean) {
  let configured: boolean;
  try {
    configured = isConfigured();
  } catch {
    return { key, checkedAt: iso(ctx.now), whenLabel: "Tried", state: "unavailable" as const, resultText: "Whether this is set up could not be read." };
  }
  if (!configured) return reachabilityFields(kind, key, { configured: false, run: null }, ctx.now);
  const read = await ctx.once(`job:${job}`, () => getJobRun(job, ctx.now));
  return reachabilityFields(kind, key, { configured: true, run: read.ok ? read.value : null }, ctx.now);
}

/* ---------- Event roll-ups ---------- */

function namesOf(events: Array<{ name: string }>, limit = 3) {
  const names = [...new Set(events.map((event) => event.name))];
  return names.length <= limit ? names.join(", ") : `${names.slice(0, limit).join(", ")} and ${names.length - limit} more`;
}

function couldNotReadNote(failed: number) {
  return failed > 0 ? ` ${failed} ${failed === 1 ? "event" : "events"} could not be read.` : "";
}

const eventHref = (path: string, eventId: string, extra = "") => `${path}?event=${encodeURIComponent(eventId)}${extra}`;

type IssueRollup = {
  key: string;
  noun: (count: number) => string;
  issues: (health: Awaited<ReturnType<typeof getOperationalHealth>>) => Array<{ severity: "URGENT" | "WATCH" }>;
  /** The page for the first event that has an issue; `null` keeps the section's own link. */
  href: (eventId: string) => string;
  none: string;
};

/** Operational-health issues, rolled up across events: event names and counts only, never a registration or a person. */
async function rollupIssues(ctx: ReportContext, rollup: IssueRollup) {
  const read = await operational(ctx);
  if (!read.ok) return { key: rollup.key, ...tried(read) };
  const { results, failed } = read.value;
  const affected = results
    .map((result) => ({ id: result.id, name: result.name, issues: rollup.issues(result.value) }))
    .filter((entry) => entry.issues.length > 0);
  const total = affected.reduce((sum, entry) => sum + entry.issues.length, 0);
  const common = { key: rollup.key, checkedAt: iso(read.value.readAt), whenLabel: "Checked" };
  if (total === 0) {
    if (failed > 0) return { ...common, whenLabel: "Tried", state: "unavailable" as const, resultText: `None found in the events that were read.${couldNotReadNote(failed)} It is not shown as OK.` };
    return { ...common, state: "ok" as const, resultText: rollup.none };
  }
  const urgent = affected.some((entry) => entry.issues.some((issue) => issue.severity === "URGENT"));
  return {
    ...common,
    state: urgent ? ("attention" as const) : ("watch" as const),
    resultText: `${total} ${rollup.noun(total)} at ${namesOf(affected)}.${couldNotReadNote(failed)}`,
    fixHref: rollup.href(affected[0].id),
  };
}

/* ---------- The providers ---------- */

const m = (key: string, name: string, description: string, fixHref: string | null = null, fixLabel: string | null = null): SignalMeta => ({ key, name, description, fixHref, fixLabel });
const serverFix = "Fixed on the server";

export const systemReportProviders: readonly SignalProvider[] = [
  defineProvider("release", [
    m("release-version", "Running version", "The code release this server is running."),
    m("release-deployed", "Last deploy", "When this version went live: when the server process started, and when the build was written."),
  ], async (ctx) => {
    const release = getReleaseIdentity();
    const checkedAt = iso(new Date());
    const version = !release.sha
      ? { key: "release-version", state: "unavailable" as const, checkedAt, whenLabel: "Tried", resultText: "The release code is not recorded on this server, so the version is not known." }
      : { key: "release-version", state: "info" as const, checkedAt, whenLabel: "Read", resultText: `Release ${release.sha.slice(0, 7)}${release.buildId ? `, build ${release.buildId}` : ""}.` };
    const { startedAt, builtAt } = getReleaseTimes(ctx.now);
    const stamp = (date: Date) => `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
    const deployed = startedAt
      ? { key: "release-deployed", state: "info" as const, checkedAt: iso(startedAt), whenLabel: "Server started", resultText: `Started ${stamp(startedAt)}.${builtAt ? ` Built ${stamp(builtAt)}.` : ""}` }
      : { key: "release-deployed", state: "unavailable" as const, checkedAt, whenLabel: "Tried", resultText: "The server's start time could not be read, so the deploy time is not known." };
    return [version, deployed];
  }),

  defineProvider("database", [
    m("database-connection", "Database connection", "The database answered a test query.", null, serverFix),
    m("database-migrations", "Database updates", "All database changes in this release have been applied.", "/admin/readiness", "Open readiness"),
  ], async (ctx) => {
    const live = await ctx.once("database-liveness", checkDatabaseLiveness);
    const connection = !live.ok
      ? { key: "database-connection", ...tried(live) }
      : live.value.ok
        ? { key: "database-connection", state: "ok" as const, checkedAt: iso(live.readAt), whenLabel: "Checked", resultText: "Answered a test query." }
        : { key: "database-connection", state: "attention" as const, checkedAt: iso(live.readAt), whenLabel: "Checked", resultText: "The database did not answer a test query." };
    return [connection, await readinessRow(ctx, "migrations", "database-migrations")];
  }),

  defineProvider("jobs", [
    m("email-sweep", "Email sweep", "The scheduled job that sends queued email succeeded in the last 15 minutes.", null, serverFix),
    m("backup-r2-database", "Newest database backup", "The newest database backup in the read-only Cloudflare R2 backup bucket is less than 26 hours old.", null, "Set on the server"),
    m("backup-r2-files", "Newest files backup", "The newest uploaded-files backup in the read-only Cloudflare R2 backup bucket (shown for information).", null, "Set on the server"),
    m("backup-last", "Last backup", "The last backup succeeded recently and reached its offsite copy.", "/admin/readiness", "Open readiness"),
    m("backup-restore-test", "Restore test", "A backup was restored as a test recently.", "/admin/readiness", "Open readiness"),
    m("calendar-feed-refresh", "Calendar feed refresh", "The imported calendar feeds that came due were refreshed by the last sweep.", "/admin/calendar", "Open calendar"),
    m("message-file-cleanup", "Message file cleanup", "The last sweep's cleanup of message attachments nothing refers to.", "/admin/email", "Open email settings"),
    m("alert-scan", "Alert scan", "The last sweep's scan for problems that need an alert.", null, serverFix),
    m("alert-delivery", "Alert delivery", "The latest alert reached the alert webhook.", null, serverFix),
    m("deadline-reminders", "Deadline reminder preparation", "The last sweep prepared the deadline reminder batches that came due.", "/admin/calendar", "Open calendar"),
    m("location-waitlist-digest", "Location waitlist digest", "The daily digest of location waitlist changes.", "/admin/email", "Open email settings"),
    m("class-waitlists", "Honors class waitlists", "The last sweep passed expired class offers to the next youth in line.", null, serverFix),
    m("instructor-class-emails", "Instructor class emails", "The emails telling instructors who joined or left their classes.", "/admin/email", "Open email settings"),
    m("honor-watch-summaries", "Honor watch summaries", "The daily watch summaries of who joined or left classes.", "/admin/email", "Open email settings"),
    m("health-snapshots", "Sealed health copies", "The sweep that seals event-start health copies and deletes expired ones.", null, serverFix),
    m("retention-cleanups", "Retention clean-ups", "The clean-ups of old community posts, alert feed items and analytics.", null, serverFix),
    m("server-autodeploy", "Auto-deploy", "The server's deploy timer checked for a new version in the last 30 minutes and the latest run did not fail.", null, serverFix),
    m("server-docker-cleanup", "Docker cleanup", "The server's daily Docker cleanup ran in the last 30 hours.", null, serverFix),
    m("server-runtime-guard", "Runtime guard", "The server's check that the app container keeps its settings ran in the last 15 minutes.", null, serverFix),
  ], async (ctx) => [
    ...(await pickHealth(ctx, ["email-sweep"])),
    ...(await offsiteBackupRows(ctx)),
    await readinessRow(ctx, "backup-offsite", "backup-last"),
    await readinessRow(ctx, "restore-rehearsal", "backup-restore-test"),
    await jobRow(ctx, CALENDAR_FEED_REFRESH_JOB, "calendar-feed-refresh", calendarRefreshFields),
    await jobRow(ctx, MESSAGE_FILE_CLEANUP_JOB, "message-file-cleanup", messageFileCleanupFields),
    await jobRow(ctx, ALERT_SCAN_JOB, "alert-scan", alertScanFields),
    await alertDeliveryRow(ctx, "alert-delivery"),
    await jobRow(ctx, DEADLINE_REMINDER_PREPARATION_JOB, "deadline-reminders", deadlineReminderFields),
    await jobRow(ctx, LOCATION_WAITLIST_DIGEST_JOB, "location-waitlist-digest", locationWaitlistDigestFields),
    await jobRow(ctx, CLASS_WAITLIST_SWEEP_JOB, "class-waitlists", classWaitlistFields),
    await jobRow(ctx, INSTRUCTOR_CLASS_EMAILS_JOB, "instructor-class-emails", instructorClassEmailFields),
    await jobRow(ctx, HONOR_WATCH_SUMMARIES_JOB, "honor-watch-summaries", honorWatchSummaryFields),
    await jobRow(ctx, HEALTH_SNAPSHOT_SWEEP_JOB, "health-snapshots", (key, run, readAt) => healthSnapshotFields(key, run, readAt, healthRecordsSwitchedOn())),
    await jobRow(ctx, RETENTION_CLEANUP_JOB, "retention-cleanups", retentionCleanupFields),
    await jobRow(ctx, SERVER_AUTODEPLOY_JOB, "server-autodeploy", autodeployFields, SERVER_AUTODEPLOY_STALE_AFTER_MS),
    await jobRow(ctx, SERVER_DOCKER_CLEANUP_JOB, "server-docker-cleanup", dockerCleanupFields, SERVER_DOCKER_CLEANUP_STALE_AFTER_MS),
    await jobRow(ctx, SERVER_RUNTIME_GUARD_JOB, "server-runtime-guard", runtimeGuardFields, SERVER_RUNTIME_GUARD_STALE_AFTER_MS),
  ]),

  defineProvider("email", [
    m("email-delivery", "Delivery problems", "Failed, bounced or spam-marked messages in the last 7 days, and messages stuck in delivery.", "/admin/email", "Review deliveries"),
    m("email-queue", "Email queue", "Messages waiting, processing or given up.", "/admin/email", "Open email settings"),
    m("email-provider", "Email provider", "An email service is set up.", "/admin/settings", "Platform settings"),
    m("email-sender", "Sender address", "The sender address is set and is not a placeholder.", "/admin/settings", "Platform settings"),
    m("email-reachable", "Email service reachable", "A read-only test that the email service answers and accepts our key. It sends nothing.", null, "Press Test connections"),
  ], async (ctx) => [
    ...(await pickHealth(ctx, ["email-delivery", "email-queue"])),
    await readinessRow(ctx, "email-provider", "email-provider"),
    await readinessRow(ctx, "email-sender", "email-sender"),
    await reachabilityRow(ctx, "email", "email-reachable", EMAIL_REACHABILITY_JOB, () => getEmailAvailability().deliveryConfigured),
  ]),

  defineProvider("payments", [
    m("payment-attempts", "Payment attempts", "Failed, or stuck over 15 minutes, on unpaid registrations.", "/more/health", "Open operational health"),
    m("payment-setup", "Payment setup", "Square and its payment notices are set up (this does not prove they work).", "/admin/settings", "Platform settings"),
    m("square-environment", "Square environment", "Whether Square is in test or live mode.", "/admin/settings", "Platform settings"),
    m("square-reachable", "Square reachable", "A read-only test that Square answers and accepts our token. It charges nothing.", null, "Press Test connections"),
    m("apple-pay-file-reachable", "Apple Pay domain file", "A read-only test that Square's Apple Pay domain file can be fetched. It sends and changes nothing.", null, "Press Test connections"),
  ], async (ctx) => {
    const attempts = await rollupIssues(ctx, {
      key: "payment-attempts",
      issues: (health) => health.paymentAttempts,
      noun: (count) => (count === 1 ? "payment attempt failed or is stuck" : "payment attempts failed or are stuck"),
      href: (eventId) => eventHref("/finance", eventId),
      none: "None failed or stuck.",
    });
    const env = await environment(ctx);
    const setup = !env.ok ? { key: "payment-setup", ...tried(env) } : paymentSetup(env.value, env.readAt);
    return [
      attempts,
      setup,
      await readinessRow(ctx, "square-environment", "square-environment"),
      await reachabilityRow(ctx, "square", "square-reachable", SQUARE_REACHABILITY_JOB, () => getSquareConfiguration().paymentConfigured),
      await reachabilityRow(ctx, "apple-pay-file", "apple-pay-file-reachable", APPLE_PAY_FILE_REACHABILITY_JOB, () => getSquareConfiguration().paymentConfigured),
    ];
  }),

  defineProvider("ledger", [
    m("ledger-check", "Ledger check", "Registration totals match the ledger.", "/more/ledger-health", "Open ledger check"),
    m("balances-due", "Balances due", "Active registrations that still owe money.", "/more/health", "Open operational health"),
  ], async (ctx) => {
    const reconciled = await ledger(ctx);
    let check: Awaited<ReturnType<Reader>>[number];
    if (!reconciled.ok) check = { key: "ledger-check", ...tried(reconciled) };
    else {
      const { results, failed, readAt } = reconciled.value;
      const checked = results.reduce((sum, result) => sum + result.value.checked, 0);
      const differing = results.filter((result) => result.value.failing.length > 0);
      const differs = differing.reduce((sum, result) => sum + result.value.failing.length, 0);
      if (differs > 0) {
        // The ledger runs beside the stored totals and some changes are not recorded in it yet, so a difference is a
        // reason to look, not proof of a wrong total.
        check = { key: "ledger-check", state: "watch", checkedAt: iso(readAt), whenLabel: "Checked", resultText: `${differs} of ${checked} registrations differ from the ledger at ${namesOf(differing)}.${couldNotReadNote(failed)}`, fixHref: eventHref("/more/ledger-health", differing[0].id) };
      } else if (failed > 0) {
        check = { key: "ledger-check", state: "unavailable", checkedAt: iso(readAt), whenLabel: "Tried", resultText: `None differ in the events that were read.${couldNotReadNote(failed)} It is not shown as OK.` };
      } else {
        check = { key: "ledger-check", state: "ok", checkedAt: iso(readAt), whenLabel: "Checked", resultText: `0 of ${checked} registrations differ.` };
      }
    }

    const ops = await operational(ctx);
    let balances: Awaited<ReturnType<Reader>>[number];
    if (!ops.ok) balances = { key: "balances-due", ...tried(ops) };
    else {
      const withBalances = ops.value.results.filter((result) => result.value.balances.length > 0);
      const owing = withBalances.reduce((sum, result) => sum + result.value.balances.length, 0);
      balances = ops.value.failed > 0
        ? { key: "balances-due", state: "unavailable", checkedAt: iso(ops.value.readAt), whenLabel: "Tried", resultText: `${owing} ${owing === 1 ? "registration owes" : "registrations owe"} money in the events that were read.${couldNotReadNote(ops.value.failed)} The total is not complete.` }
        : { key: "balances-due", state: "info", checkedAt: iso(ops.value.readAt), whenLabel: "Checked", resultText: `${owing} ${owing === 1 ? "registration owes" : "registrations owe"} money. A count only: owing money is normal before an event.`, ...(withBalances[0] ? { fixHref: eventHref("/finance", withBalances[0].id, "&filter=BALANCE") } : {}) };
    }
    return [check, balances];
  }),

  defineProvider("storage", [
    m("message-file-storage", "Message file storage", "Attachment space used against each event's limit.", "/admin/email", "Open email settings"),
    m("server-disk-space", "Server disk space", "Free space left on the disk that holds uploads.", null, serverFix),
  ], async (ctx) => {
    const disk = await ctx.once("disk-space", () => readDiskSpace());
    const diskRow = disk.ok ? { ...diskFields("server-disk-space", disk.value, disk.readAt) } : { key: "server-disk-space", ...tried(disk, "Free space could not be read. It is not shown as healthy.") };
    const read = await ctx.once("message-file-usage", getMessageFileStorageUsage);
    if (!read.ok) return [{ key: "message-file-storage", ...tried(read, "Storage use could not be read. Check again in a few minutes.") }, diskRow];
    const usage = read.value;
    const quota = usage.quotaBytes;
    const percent = (event: { usedBytes: number }) => (quota > 0 ? (event.usedBytes / quota) * 100 : 0);
    const full = usage.events.filter((event) => percent(event) >= 100);
    const near = usage.events.filter((event) => percent(event) >= 90 && percent(event) < 100);
    const name = (event: { eventName: string | null }) => ({ name: event.eventName ?? "a removed event" });
    const pending = usage.events.reduce((sum, event) => sum + event.pendingCleanupCount, 0);
    const tail = `${pending} ${pending === 1 ? "file" : "files"} waiting to be removed from disk. ${usage.expiredReservations} expired upload ${usage.expiredReservations === 1 ? "reservation" : "reservations"}. Cleanup is in ${usage.sweepMode === "delete" ? "delete" : "dry-run"} mode.`;
    const common = { key: "message-file-storage", checkedAt: iso(read.readAt), whenLabel: "Checked" };
    if (full.length > 0) return [{ ...common, state: "attention", resultText: `${full.length} ${full.length === 1 ? "event is" : "events are"} at the attachment limit: ${namesOf(full.map(name))}. ${tail}` }, diskRow];
    if (near.length > 0) return [{ ...common, state: "watch", resultText: `${near.length} ${near.length === 1 ? "event is" : "events are"} at 90% or more of the attachment limit: ${namesOf(near.map(name))}. ${tail}` }, diskRow];
    return [{ ...common, state: "ok", resultText: `${usage.events.length} ${usage.events.length === 1 ? "event uses" : "events use"} attachment space, none near the limit. ${tail}` }, diskRow];
  }),

  defineProvider("imports", [
    m("import-review", "Import review", "Unfinished or failed import previews.", "/more/health", "Open operational health"),
    m("capacity", "Capacity", "Events or limited choices at 90% full or more.", "/more/health", "Open operational health"),
  ], async (ctx) => [
    await rollupIssues(ctx, {
      key: "import-review",
      issues: (health) => health.imports,
      noun: (count) => (count === 1 ? "import needs review" : "imports need review"),
      href: (eventId) => eventHref("/imports", eventId),
      none: "None waiting.",
    }),
    await rollupIssues(ctx, {
      key: "capacity",
      issues: (health) => health.capacity,
      noun: (count) => (count === 1 ? "event or choice is near full" : "events or choices are near full"),
      href: (eventId) => eventHref("/people", eventId),
      none: "None near full.",
    }),
  ]),

  defineProvider("alerts", [
    m("open-alerts", "Unresolved alerts", "Alerts the scheduled scan has raised and is still reporting as unresolved.", null, "Fix page not confirmed"),
  ], async (ctx) => pickHealth(ctx, ["open-alerts"])),

  defineProvider("setup", [
    m("encryption-key", "Encryption key", "The key that protects stored private data is set (the value is never shown).", "/admin/settings", "Platform settings"),
    m("admin-protection", "Administrator sign-in protection", "System administrators use two-step sign-in or a passkey.", "/admin/readiness", "Open readiness"),
    m("connected-services", "Connected services", "Payments, email, Google sign-in, alerts and the email sweep are set up (this does not prove they work).", "/admin/settings", "Platform settings"),
    m("google-keys-reachable", "Google sign-in keys", "A read-only test that Google's public sign-in keys can be fetched. It sends and changes nothing.", null, "Press Test connections"),
    m("breach-service-reachable", "Password breach service", "A read-only test that the password breach service answers one fixed, made-up lookup. No password is used.", null, "Press Test connections"),
    m("security-check", "Security check", "Cloudflare Turnstile on public forms and sign-in has both its keys set (environment names only; no key is shown).", null, serverFix),
  ], async (ctx) => {
    const env = await environment(ctx);
    return [
      await readinessRow(ctx, "encryption-key", "encryption-key"),
      await readinessRow(ctx, "admins-mfa", "admin-protection"),
      !env.ok ? { key: "connected-services", ...tried(env) } : connectedServices(env.value, env.readAt),
      await reachabilityRow(ctx, "google-keys", "google-keys-reachable", GOOGLE_KEYS_REACHABILITY_JOB, isGoogleSignInConfigured),
      await reachabilityRow(ctx, "breach-service", "breach-service-reachable", BREACH_SERVICE_REACHABILITY_JOB, isBreachCheckEnabled),
      securityCheckFields(undefined, ctx.now),
    ];
  }),

  defineProvider("public-site", [
    m("broken-links", "Broken links and images", "Pages not found and images that failed to load, last 30 days.", "/admin/analytics", "Open analytics"),
    m("page-speed", "Page speed", "How public pages loaded for visitors, last 30 days.", "/admin/analytics", "Open analytics"),
    m("calendar-feed-reachable", "Calendar feed", "A read-only test that our own public calendar feed builds. No network is used and nothing is changed.", null, "Press Test connections"),
  ], async (ctx) => {
    const read = await ctx.once("analytics", () => getAnalyticsSummary(conferenceToday()));
    const calendarFeed = await reachabilityRow(ctx, "calendar-feed", "calendar-feed-reachable", CALENDAR_FEED_REACHABILITY_JOB, () => true);
    if (!read.ok) return [{ key: "broken-links", ...tried(read) }, { key: "page-speed", ...tried(read) }, calendarFeed];
    const { totals, vitals } = read.value;
    const checkedAt = iso(read.readAt);
    const rating = (key: "good" | "needsImprovement" | "poor") => vitals.reduce((sum, vital) => sum + vital[key], 0);
    // No threshold is set for these, so they are counts, never "OK".
    return [
      { key: "broken-links", state: "info", checkedAt, whenLabel: "Checked", resultText: `${totals.NOT_FOUND} pages not found, ${totals.IMAGE_ERROR} image errors.` },
      { key: "page-speed", state: "info", checkedAt, whenLabel: "Checked", resultText: `${rating("good")} good, ${rating("needsImprovement")} needs improvement, ${rating("poor")} poor ratings.` },
      calendarFeed,
    ];
  }),

  defineProvider("checklist", [
    m("checklist-server", "Server items", "Ticked by a person on the readiness page.", "/admin/readiness", "Open readiness"),
    m("checklist-go-live", "Go-live sign-offs", "Ticked by a person on the readiness page.", "/admin/readiness", "Open readiness"),
  ], async (ctx) => {
    const read = await readiness(ctx);
    const keyOf = (id: string) => (id === "server" ? "checklist-server" : "checklist-go-live");
    if (!read.ok) return ["checklist-server", "checklist-go-live"].map((key) => ({ key, ...tried(read), countsTowardOverall: false }));
    const { groups, ticksAvailable } = read.value;
    const done = groups.reduce((sum, group) => sum + group.items.filter((item) => item.tick).length, 0);
    const total = groups.reduce((sum, group) => sum + group.items.length, 0);
    const sectionLabel = ticksAvailable ? `${done} of ${total} ticked` : undefined;
    return groups.map((group) => {
      const ticked = group.items.filter((item) => item.tick);
      const last = ticked.map((item) => item.tick!.tickedAt).sort().at(-1) ?? null;
      if (!ticksAvailable) return { key: keyOf(group.id), ...tried(read, "The ticks could not be read."), countsTowardOverall: false };
      return {
        key: keyOf(group.id),
        state: ticked.length === group.items.length ? ("ok" as const) : ("watch" as const),
        checkedAt: last,
        whenLabel: "Last tick",
        resultText: `${ticked.length} of ${group.items.length} ticked.`,
        countsTowardOverall: false,
        sectionLabel,
      };
    });
  }),

  defineProvider("registration", [
    m("pricing-self-test", "Pricing self-test", "The pricing arithmetic (form total, early-bird price, quantity, promo code, deposit, card fee) gives the known answers for one fixed example. It reads no registration.", "/registration-builder", "Open the form builder"),
    m("capacity-holds-released", "Capacity holds released", "No capacity hold is still kept by a cancelled or waitlisted registration.", "/people", "Open registrations"),
    m("open-without-form", "Open events have a form", "Every event that is open for registration has a published registration form.", "/registration-builder", "Open the form builder"),
    m("registrations-received", "Registrations received", "Public registration submissions in the last 24 hours for open events. A count only.", "/people", "Open registrations"),
    m("general-link-expiry", "Pending-team expiry", "The last sweep's expiry of general-link teams still waiting 30 days after their event ended.", "/events-admin", "Open events"),
  ], async (ctx) => {
    let pricing: Awaited<ReturnType<Reader>>[number];
    try {
      pricing = pricingSelfTestFields("pricing-self-test", runPricingSelfTest(), iso(new Date()));
    } catch (error) {
      logError("System report pricing self-test could not run", error);
      pricing = { key: "pricing-self-test", ...tried({ ok: false, readAt: new Date() }, "The pricing self-test could not run. It is not shown as OK.") };
    }

    const windowStart = new Date(ctx.now.getTime() - EVENT_LOOKBACK_MS);
    const opened = await ctx.once("registration-open-events", () => readOpenRegistrationEvents(ctx.now, windowStart));
    const events = await reportEvents(ctx);

    let holds: Awaited<ReturnType<Reader>>[number];
    if (!events.ok) holds = { key: "capacity-holds-released", ...tried(events) };
    else {
      const ids = events.value.map((event) => event.id);
      const read = await ctx.once("registration-unreleased-holds", () => readUnreleasedHoldCounts(ids));
      if (!read.ok) holds = { key: "capacity-holds-released", ...tried(read) };
      else {
        const named = read.value.map((row) => events.value.find((event) => event.id === row.eventId)).filter((event): event is { id: string; name: string } => Boolean(event));
        holds = unreleasedHoldsFields("capacity-holds-released", {
          total: read.value.reduce((sum, row) => sum + row.count, 0),
          firstEventId: read.value[0]?.eventId ?? null,
          firstEventHref: (eventId) => eventHref("/people", eventId),
          eventNames: namesOf(named),
          readAt: iso(read.readAt),
        });
      }
    }

    let noForm: Awaited<ReturnType<Reader>>[number];
    let received: Awaited<ReturnType<Reader>>[number];
    if (!opened.ok) {
      noForm = { key: "open-without-form", ...tried(opened) };
      received = { key: "registrations-received", ...tried(opened) };
    } else {
      noForm = openWithoutFormFields("open-without-form", {
        openCount: opened.value.length,
        withoutForm: opened.value.filter((event) => !event.hasPublishedForm),
        namesOf,
        href: (eventId) => eventHref("/registration-builder", eventId),
        readAt: iso(opened.readAt),
      });
      const since = new Date(ctx.now.getTime() - 24 * 60 * 60 * 1000);
      const count = await ctx.once("registration-public-submissions", () => countPublicSubmissionsSince(opened.value.map((event) => event.id), since));
      received = !count.ok
        ? { key: "registrations-received", ...tried(count) }
        : registrationsReceivedFields("registrations-received", { count: count.value, openCount: opened.value.length, readAt: iso(count.readAt) });
    }

    return [pricing, holds, noForm, received, await jobRow(ctx, GENERAL_LINK_EXPIRY_JOB, "general-link-expiry", generalLinkExpiryFields)];
  }),
  ...buildMoneyProviders({ defineProvider, reportEvents, perEvent, tried, iso, m, jobRow, couldNotReadNote, eventHref }),
  ...buildCommunicationsProviders({ defineProvider, tried, iso, m }),
  ...buildNoticeProviders(defineProvider),
  ...buildEmailBackupProviders(defineProvider),
  ...buildEventOpsProviders({ defineProvider, reportEvents, perEvent, tried, iso, m, couldNotReadNote, eventHref }),
  ...buildSelfTestProviders({ defineProvider, m, tried }),
];

/* ---------- Environment status rows ---------- */

type EnvService = EnvironmentStatus["services"][number];

function paymentSetup(status: EnvironmentStatus, readAt: Date) {
  const services = status.services.filter((service) => service.id === "payments" || service.id === "payment-webhook");
  return summarizeServices("payment-setup", services, readAt);
}

function connectedServices(status: EnvironmentStatus, readAt: Date) {
  return summarizeServices("connected-services", status.services, readAt);
}

/** "Set up" is a configuration fact, never proof the service works: the labels are fixed names, never values. */
function summarizeServices(key: string, services: EnvService[], readAt: Date) {
  const setUp = services.filter((service) => service.status === "configured").length;
  const notSet = services.filter((service) => service.status === "not-configured");
  const unknown = services.filter((service) => service.status === "unknown");
  const common = { key, checkedAt: iso(readAt) };
  const counted = `${setUp} of ${services.length} set up.`;
  if (notSet.length > 0) {
    return { ...common, whenLabel: "Checked", state: "watch" as const, resultText: `${counted} Not set up: ${notSet.map((service) => service.label).join(", ")}.` };
  }
  if (unknown.length > 0) {
    return { ...common, whenLabel: "Tried", state: "unavailable" as const, resultText: `${counted} Could not be read: ${unknown.map((service) => service.label).join(", ")}.` };
  }
  return { ...common, whenLabel: "Checked", state: "ok" as const, resultText: `${counted} Set up does not prove a service works.` };
}
