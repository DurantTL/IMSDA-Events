import { getEncryptionKeyStatus } from "@/lib/env";
import { checkDatabaseLiveness } from "@/modules/operations/database-liveness";
import { getOutboxQueueHealth } from "@/modules/communications/outbox-sweep";
import { logError } from "@/lib/logger";
import { dispatchUnsuppressedAlert } from "@/modules/operations/alerting";
import { withRequestContext } from "@/lib/request-context";
import { getReleaseIdentity } from "@/lib/release";
import { getSweepHeartbeat } from "@/modules/operations/sweep-heartbeat-repository";
import { getBackupStatus } from "@/modules/operations/backup-status-repository";
import { hasHealthDetailToken, isSystemAdministratorSession } from "@/modules/operations/health-access";
import { backupHelperHasReported, backupStatusDegradesHealth, toPublicBackupStatus } from "@/modules/operations/backup-status";
import { getOffsiteBackups } from "@/modules/operations/offsite-backups-reader";
import { offsiteDatabaseStatus, type OffsiteBackupResult } from "@/modules/operations/offsite-backups";

/**
 * Liveness and readiness in one response.
 *
 * The database check alone reported `ok` while email delivery was completely
 * broken, so the outbox is checked too. A backed-up queue is `degraded`, not
 * `unavailable`: the container should stay up and keep serving registrations
 * while somebody investigates, so only a database failure returns 503.
 *
 * The public answer (#1400) is only "the app is up and the database answers":
 * status, time and the database check. The detail below (release, backups,
 * outbox, sweep, key source) needs the sweep token, the monitor token or a
 * system-administrator session. The public status is never degraded by backups,
 * the outbox or the sweep, and those queries do not run for public callers.
 */
const NO_STORE = { "Cache-Control": "no-store" } as const;

type OffsiteHealthStatus = "ok" | "stale" | "missing" | "not_connected" | "misconfigured" | "error";

function offsiteHealthStatus(result: OffsiteBackupResult): OffsiteHealthStatus {
  if (result.state !== "checked") return result.state;
  return offsiteDatabaseStatus(result, new Date()) ?? "error";
}

/** Times and sizes only: no labels, keys, bucket or account. */
function offsiteSummary(result: OffsiteBackupResult, status: OffsiteHealthStatus) {
  const entry = (value: { at: string; bytes: number | null } | null) => (value ? { at: value.at, bytes: value.bytes } : null);
  return {
    status,
    newestDatabase: result.state === "checked" ? entry(result.database) : null,
    newestFiles: result.state === "checked" ? entry(result.files) : null,
    partial: result.state === "checked" ? result.partial : false,
    checkedAt: result.state === "checked" || result.state === "error" ? result.checkedAt : null,
    ...(result.state === "error" ? { reason: result.reason } : {}),
  };
}

async function getHandler(request: Request) {
  const tokenAuthorized = hasHealthDetailToken(request);
  const checkedAt = new Date().toISOString();

  const database = await checkDatabaseLiveness();
  if (!database.ok) {
    logError("Health check failed", database.error);
    // There is nowhere to record suppression when the database is the thing
    // that is down, so this always attempts delivery. An orchestrator polling
    // this endpoint will repeat it, which is the correct amount of noise for a
    // total outage.
    await dispatchUnsuppressedAlert({
      key: "system.database.unavailable",
      severity: "URGENT",
      summary: "The database is unreachable",
      detail: "Registrations, check-in, and payment cannot be recorded until it returns.",
    }).catch(() => undefined);
    // Neither of these needs the database, so a token holder still gets them;
    // the public body stays minimal.
    return Response.json(
      tokenAuthorized
        ? {
            status: "degraded",
            checkedAt,
            release: getReleaseIdentity(),
            services: { application: "ok", database: "unavailable" },
            encryptionKey: getEncryptionKeyStatus(),
          }
        : { status: "degraded", checkedAt, services: { database: "unavailable" } },
      { status: 503, headers: NO_STORE }
    );
  }

  // Only now, with the database answering, look up a session. A lookup error
  // is an unauthorized caller, never a failed health check.
  const authorized = tokenAuthorized || (await isSystemAdministratorSession());
  if (!authorized) {
    return Response.json(
      { status: "ok", checkedAt, services: { database: "ok" } },
      { headers: NO_STORE }
    );
  }

  const release = getReleaseIdentity();
  // Whether a key is configured and how it was loaded. Never the key itself.
  const encryptionKey = getEncryptionKeyStatus();

  let outbox: Awaited<ReturnType<typeof getOutboxQueueHealth>> | null = null;
  try {
    outbox = await getOutboxQueueHealth();
  } catch (error) {
    logError("Outbox health check failed", error);
  }

  // The sweep runs the alert scan, so a stopped sweep cannot alert about
  // itself; an uptime monitor reading this response is what catches it. A
  // sweep that has never reported is shown but does not degrade the status,
  // so a fresh deployment is not unhealthy before its first run.
  let outboxSweep: Awaited<ReturnType<typeof getSweepHeartbeat>> | null = null;
  try {
    outboxSweep = await getSweepHeartbeat();
  } catch (error) {
    logError("Outbox sweep heartbeat check failed", error);
  }
  const sweepDegraded = outboxSweep?.status === "stale" || outboxSweep?.status === "failing";

  // Backups: a stale, failing or unrehearsed backup is `degraded`, never 503,
  // so the app stays in rotation. This endpoint is public, so only the status,
  // staleness and two times are shown; sizes and off-site detail stay behind
  // getBackupStatus() for the admin readiness page.
  let backups: Awaited<ReturnType<typeof getBackupStatus>> | null = null;
  try {
    backups = await getBackupStatus();
  } catch (error) {
    logError("Backup status check failed", error);
  }
  const backupsDegraded = backupStatusDegradesHealth(backups);

  // Production backups are made by xCloud into Cloudflare R2 (#1412). With read-only R2 settings the app lists the
  // newest objects (cached, time-boxed, list-only). A stale or missing database backup degrades; an R2 read error is
  // shown but never degrades, so a Cloudflare blip does not flap the monitor. Only this authorized branch reads it.
  let offsite: OffsiteBackupResult = { state: "not_connected" };
  try {
    offsite = await getOffsiteBackups();
  } catch (error) {
    logError("Offsite backup check failed", error);
    offsite = { state: "error", reason: "could not be read", checkedAt };
  }
  const offsiteStatus = offsiteHealthStatus(offsite);
  const offsiteDegraded = offsiteStatus === "stale" || offsiteStatus === "missing";
  const backupsService =
    offsite.state !== "not_connected" ? offsiteStatus
    : backupHelperHasReported(backups) ? (backups?.status ?? "unknown")
    : backups ? "not_connected" : "unknown";

  return Response.json(
    {
    status:
      (outbox && outbox.status !== "ok") || sweepDegraded || backupsDegraded || offsiteDegraded
        ? "degraded"
        : "ok",
    checkedAt,
    release,
    services: {
      application: "ok",
      database: "ok",
      messageOutbox: outbox?.status ?? "unknown",
      outboxSweep: outboxSweep?.status ?? "unknown",
      backups: backupsService,
    },
    offsiteBackups: offsiteSummary(offsite, offsiteStatus),
    outboxSweep,
    backups: backups ? toPublicBackupStatus(backups) : null,
    encryptionKey,
    messageOutbox: outbox
      ? {
          status: outbox.status,
          reasons: outbox.reasons,
          pending: outbox.pending,
          due: outbox.due,
          processing: outbox.processing,
          failed: outbox.failed,
          oldestDueAgeMs: outbox.oldestDueAgeMs,
          eventsWithDueMessages: outbox.eventsWithDueMessages,
        }
      : null,
    },
    { headers: NO_STORE }
  );
}

export const GET = withRequestContext(getHandler);
