import type { JobRun } from "@/modules/operations/sweep-heartbeat-repository";
import { REACHABILITY_STALE_AFTER_MS } from "@/modules/operations/reachability";
import type { DiskSpace } from "@/modules/operations/disk-space";
import type { Signal } from "./model";

/**
 * Pure mappers from a stored job run, a disk reading or a stored connection test to report signals (#1357). They hold
 * the wording and the thresholds, and read nothing. Each returns the fields a provider adds to its declared row.
 */
type Fields = Pick<Signal, "key" | "state" | "resultText" | "checkedAt" | "whenLabel"> & Partial<Pick<Signal, "noTimeLabel">>;

const iso = (date: Date) => date.toISOString();
const latest = (run: JobRun) => [run.lastSucceededAt, run.lastFailedAt].filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;

function num(summary: JobRun["summary"], key: string): number | null {
  const value = summary?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** A job that never reported, whose latest run failed, or that has not succeeded lately is never shown as OK. */
function runProblem(key: string, run: JobRun, readAt: Date, noun: string): Fields | null {
  if (run.status === "never") {
    return { key, state: "unavailable", checkedAt: iso(readAt), whenLabel: "Tried", resultText: `Never reported: ${noun} has not recorded a run yet, so there is nothing to show as healthy.` };
  }
  if (run.status === "failing") {
    return { key, state: "attention", checkedAt: run.lastFailedAt, whenLabel: "Last failure", resultText: `The latest run failed. Check the app logs.` };
  }
  if (run.status === "stale") {
    return { key, state: "watch", checkedAt: run.lastSucceededAt, whenLabel: "Last success", resultText: `No successful run in over an hour. The five-minute sweep may have stopped.` };
  }
  return null;
}

export function calendarRefreshFields(key: string, run: JobRun, readAt: Date): Fields {
  const problem = runProblem(key, run, readAt, "the calendar feed refresh");
  if (problem) return problem;
  const due = num(run.summary, "due");
  const refreshed = num(run.summary, "refreshed");
  const failed = num(run.summary, "failed");
  if (due === null || refreshed === null || failed === null) {
    return { key, state: "watch", checkedAt: run.lastSucceededAt, whenLabel: "Last success", resultText: "It ran, but its counts were not recorded." };
  }
  const text = `${due} due, ${refreshed} refreshed, ${failed} failed.`;
  return failed > 0
    ? { key, state: "watch", checkedAt: run.lastSucceededAt, whenLabel: "Last success", resultText: `${text} A feed that failed is recorded on the calendar page.` }
    : { key, state: "ok", checkedAt: run.lastSucceededAt, whenLabel: "Last success", resultText: text };
}

export function payOnSquareLinkSweepFields(key: string, run: JobRun, readAt: Date): Fields {
  const problem = runProblem(key, run, readAt, "the Pay on Square link sweep");
  if (problem) return problem;
  const withdrawn = num(run.summary, "withdrawn");
  const deleted = num(run.summary, "deleted");
  const failed = num(run.summary, "failed");
  if (withdrawn === null || deleted === null || failed === null) {
    return { key, state: "watch", checkedAt: run.lastSucceededAt, whenLabel: "Last success", resultText: "It ran, but its counts were not recorded." };
  }
  const text = `${withdrawn} withdrawn, ${deleted} deleted at Square, ${failed} deletions failed.`;
  return failed > 0
    ? { key, state: "watch", checkedAt: run.lastSucceededAt, whenLabel: "Last success", resultText: `${text} The next sweep tries again.` }
    : { key, state: "ok", checkedAt: run.lastSucceededAt, whenLabel: "Last success", resultText: text };
}

export function messageFileCleanupFields(key: string, run: JobRun, readAt: Date): Fields {
  const problem = runProblem(key, run, readAt, "the message file cleanup");
  if (problem) return problem;
  const mode = run.summary?.mode;
  const candidates = num(run.summary, "candidates");
  const deleted = num(run.summary, "deleted");
  const pending = num(run.summary, "cleanupPending");
  const failed = num(run.summary, "cleanupFailed");
  if (typeof mode !== "string" || candidates === null || deleted === null || pending === null || failed === null) {
    return { key, state: "watch", checkedAt: run.lastSucceededAt, whenLabel: "Last success", resultText: "It ran, but its counts were not recorded." };
  }
  const text = `${mode === "apply" ? "Deleting" : "Report only"}: ${candidates} unused, ${deleted} deleted, ${pending} waiting to be removed, ${failed} removals failed.`;
  return { key, state: failed > 0 ? "watch" : "ok", checkedAt: run.lastSucceededAt, whenLabel: "Last success", resultText: text };
}

/** Step 14 of the sweep: waiting general-link teams past retention. Counts only; a quiet run (0 expired) is normal. */
export function generalLinkExpiryFields(key: string, run: JobRun, readAt: Date): Fields {
  const problem = runProblem(key, run, readAt, "the pending-team expiry");
  if (problem) return problem;
  const expired = num(run.summary, "expired");
  const events = num(run.summary, "events");
  if (expired === null || events === null) {
    return { key, state: "watch", checkedAt: run.lastSucceededAt, whenLabel: "Last success", resultText: "It ran, but its counts were not recorded." };
  }
  return { key, state: "ok", checkedAt: run.lastSucceededAt, whenLabel: "Last success", resultText: `${expired} waiting ${expired === 1 ? "team" : "teams"} expired across ${events} ${events === 1 ? "event" : "events"}.` };
}

/* ---------- The rest of the sweep's steps (#1377) ---------- */

const COUNTS_MISSING = "It ran, but its counts were not recorded.";

function ranFields(key: string, run: JobRun, state: Fields["state"], resultText: string): Fields {
  return { key, state, checkedAt: run.lastSucceededAt, whenLabel: "Last success", resultText };
}

/** Reads the named counts; null when any is missing, so the row says so instead of showing zeros. */
function counts<K extends string>(run: JobRun, keys: readonly K[]): Record<K, number> | null {
  const out = {} as Record<K, number>;
  for (const name of keys) {
    const value = num(run.summary, name);
    if (value === null) return null;
    out[name] = value;
  }
  return out;
}

export function alertScanFields(key: string, run: JobRun, readAt: Date): Fields {
  const problem = runProblem(key, run, readAt, "the alert scan");
  if (problem) return problem;
  const c = counts(run, ["sent", "suppressed", "undelivered", "cleared"]);
  if (!c) return ranFields(key, run, "watch", COUNTS_MISSING);
  const text = `${c.sent} sent, ${c.suppressed} held back, ${c.undelivered} not delivered, ${c.cleared} cleared.`;
  return c.undelivered > 0
    ? ranFields(key, run, "watch", `${text} An alert that was not delivered is tried again on the next sweep.`)
    : ranFields(key, run, "ok", text);
}

/**
 * Whether alerts reach their webhook. A delivery only happens when an alert fires, so there is no staleness rule here:
 * a quiet week is not a problem. Not set up reads "Check soon" like the connection tests; set up but never used reads
 * unavailable (never OK, because nothing has proved it works); the latest attempt failing is attention.
 */
export function alertDeliveryFields(key: string, input: { configured: boolean; run: JobRun | null }, readAt: Date): Fields {
  if (!input.configured) {
    return { key, state: "watch", checkedAt: iso(readAt), whenLabel: "Checked", resultText: "Not set up, so alerts are only written to the app logs." };
  }
  const { run } = input;
  if (!run) {
    return { key, state: "unavailable", checkedAt: iso(readAt), whenLabel: "Tried", resultText: "The last delivery result could not be read." };
  }
  const at = latest(run);
  if (run.status === "never" || !at) {
    return { key, state: "unavailable", checkedAt: null, whenLabel: "Last delivery", noTimeLabel: "Never", resultText: "No alert has needed sending yet, so delivery has not been proved." };
  }
  if (run.status === "failing") {
    const status = num(run.summary, "status");
    const how = status !== null ? `the webhook answered with HTTP ${status}` : "the webhook could not be reached";
    return { key, state: "attention", checkedAt: at, whenLabel: "Last failure", resultText: `The latest alert was not delivered: ${how}. Check the alert webhook setting on the server.` };
  }
  return { key, state: "ok", checkedAt: at, whenLabel: "Last delivery", resultText: "The latest alert reached the webhook." };
}

export function deadlineReminderFields(key: string, run: JobRun, readAt: Date): Fields {
  const problem = runProblem(key, run, readAt, "deadline reminder preparation");
  if (problem) return problem;
  const c = counts(run, ["prepared", "updated", "withdrawn"]);
  if (!c) return ranFields(key, run, "watch", COUNTS_MISSING);
  return ranFields(key, run, "ok", `${c.prepared} prepared, ${c.updated} updated, ${c.withdrawn} withdrawn. Nothing is emailed until a system administrator sends a batch.`);
}

export function locationWaitlistDigestFields(key: string, run: JobRun, readAt: Date): Fields {
  const problem = runProblem(key, run, readAt, "the location waitlist digest");
  if (problem) return problem;
  const status = run.summary?.status;
  if (status === "SWITCHED_OFF") return ranFields(key, run, "info", "Switched off in the notification settings. Changes wait until it is turned on.");
  if (status === "NOT_DUE") return ranFields(key, run, "ok", "Not due yet. It sends once a day, in the morning.");
  if (status === "NO_CHANGES") return ranFields(key, run, "ok", "Nothing changed, so no digest was needed.");
  if (status === "EMAIL_NOT_CONFIGURED") return ranFields(key, run, "watch", "Changes are waiting because account email is not set up.");
  const c = counts(run, ["changesCovered", "recipients", "delivered"]);
  if (status !== "QUEUED" || !c) return ranFields(key, run, "watch", COUNTS_MISSING);
  return ranFields(key, run, "ok", `${c.changesCovered} changes covered, ${c.recipients} recipients, ${c.delivered} delivered.`);
}

export function classWaitlistFields(key: string, run: JobRun, readAt: Date): Fields {
  const problem = runProblem(key, run, readAt, "the class waitlist sweep");
  if (problem) return problem;
  const c = counts(run, ["classes", "offered", "lapsed", "failed"]);
  const exhausted = run.summary?.budgetExhausted;
  if (!c || typeof exhausted !== "boolean") return ranFields(key, run, "watch", COUNTS_MISSING);
  const text = `${c.classes} classes checked, ${c.offered} offered, ${c.lapsed} lapsed, ${c.failed} failed.`;
  if (c.failed > 0) return ranFields(key, run, "watch", `${text} A class that failed is tried again on the next sweep.`);
  if (exhausted) return ranFields(key, run, "watch", `${text} The sweep ran out of time and carries on next time.`);
  return ranFields(key, run, "ok", text);
}

export function instructorClassEmailFields(key: string, run: JobRun, readAt: Date): Fields {
  const problem = runProblem(key, run, readAt, "the instructor class emails");
  if (problem) return problem;
  if (run.summary?.status === "SWITCHED_OFF") return ranFields(key, run, "info", "Switched off in the notification settings.");
  const c = counts(run, ["queued", "failed", "delivered"]);
  if (!c) return ranFields(key, run, "watch", COUNTS_MISSING);
  const text = `${c.queued} queued, ${c.delivered} delivered, ${c.failed} failed.`;
  return ranFields(key, run, c.failed > 0 ? "watch" : "ok", c.failed > 0 ? `${text} A failed email is tried again on the next sweep.` : text);
}

export function honorWatchSummaryFields(key: string, run: JobRun, readAt: Date): Fields {
  const problem = runProblem(key, run, readAt, "the honor watch summaries");
  if (problem) return problem;
  if (run.summary?.status === "SWITCHED_OFF") return ranFields(key, run, "info", "Switched off in the notification settings.");
  const c = counts(run, ["watches", "queued", "failed", "delivered"]);
  if (!c) return ranFields(key, run, "watch", COUNTS_MISSING);
  const text = `${c.watches} watches, ${c.queued} queued, ${c.delivered} delivered, ${c.failed} failed.`;
  return ranFields(key, run, c.failed > 0 ? "watch" : "ok", c.failed > 0 ? `${text} A failed summary is tried again on the next sweep.` : text);
}

/**
 * Sealed health copies. With health records switched off nothing new is sealed, which is a choice and not a problem, so
 * the row reads "Off" as a count-only note (never OK, never a warning). The sweep still deletes expired copies while off,
 * so a stored failed or stale run still surfaces, and an unreadable run is unavailable rather than a reassuring Off.
 */
export function healthSnapshotFields(key: string, run: JobRun | null, readAt: Date, enabled: boolean): Fields {
  if (!run) return { key, state: "unavailable", checkedAt: iso(readAt), whenLabel: "Tried", resultText: "The last run could not be read. It is not shown as healthy." };
  const off = "Off. Health records are switched off, so no health copies are sealed.";
  if (!enabled && run.status === "never") return { key, state: "info", checkedAt: iso(readAt), whenLabel: "Checked", resultText: off };
  const problem = runProblem(key, run, readAt, "the sealed health copy sweep");
  if (problem) return problem;
  if (!enabled) {
    const deleted = num(run.summary, "deleted");
    return ranFields(key, run, "info", deleted === null ? off : `${off} ${deleted} expired copies deleted.`);
  }
  const c = counts(run, ["taken", "sealFailed", "deleted", "heldSkipped"]);
  if (!c) return ranFields(key, run, "watch", COUNTS_MISSING);
  const text = `${c.taken} sealed, ${c.sealFailed} failed to seal, ${c.deleted} expired copies deleted, ${c.heldSkipped} kept for a legal hold.`;
  return ranFields(key, run, c.sealFailed > 0 ? "watch" : "ok", text);
}

export function retentionCleanupFields(key: string, run: JobRun, readAt: Date): Fields {
  const problem = runProblem(key, run, readAt, "the retention clean-ups");
  if (problem) return problem;
  const c = counts(run, ["community", "alertFeed", "analytics"]);
  if (!c) return ranFields(key, run, "watch", COUNTS_MISSING);
  return ranFields(key, run, "ok", `Deleted ${c.community} community posts, ${c.alertFeed} alert feed items and ${c.analytics} daily analytics rows past their keep time.`);
}

/** Under 10% free is attention, under 20% is watch. Only a percentage and a size are ever shown, never the path. */
export const DISK_ATTENTION_PERCENT = 10;
export const DISK_WATCH_PERCENT = 20;

export function diskFields(key: string, disk: DiskSpace, readAt: Date): Fields {
  const percent = Math.round(disk.percentFree * 10) / 10;
  const gb = Math.round((disk.freeBytes / 1024 ** 3) * 10) / 10;
  const text = `${percent}% free (${gb} GB).${disk.fellBack ? " Uploads folder not found; measured the app disk." : ""}`;
  const measured = disk.percentFree < DISK_ATTENTION_PERCENT ? "attention" : disk.percentFree < DISK_WATCH_PERCENT ? "watch" : "ok";
  // Measuring a different disk than uploads use is never shown as plain OK.
  const state = disk.fellBack && measured === "ok" ? "watch" : measured;
  return { key, state, checkedAt: iso(readAt), whenLabel: "Checked", resultText: text };
}

const REACHABLE_WORDS = {
  email: { name: "The email service", refused: "The email service refused the key. Check the email settings on the server." },
  square: { name: "Square", refused: "Square refused the access token. Check the Square settings on the server." },
  "google-keys": { name: "Google's sign-in keys page", refused: "Google refused the request for its sign-in keys. Check the Google sign-in settings on the server." },
  "breach-service": { name: "The password breach service", refused: "The password breach service refused the request. Check the password breach settings on the server." },
  "apple-pay-file": { name: "Square's Apple Pay domain file", refused: "Square refused the request for the Apple Pay domain file. Check the Square settings on the server." },
  "calendar-feed": { name: "The public calendar feed", refused: "The public calendar feed refused the request." },
} as const;

export type ReachabilityKind = keyof typeof REACHABLE_WORDS;

/**
 * A stored connection test (never run on page load). Never tested reads unavailable with no time; a result over 24
 * hours old reads "Test again"; "refused" is attention; "unavailable" is unavailable; only a fresh "reachable" is OK.
 */
export function reachabilityFields(kind: ReachabilityKind, key: string, input: { configured: boolean; run: JobRun | null }, now: Date): Fields {
  const words = REACHABLE_WORDS[kind];
  if (!input.configured) {
    return { key, state: "watch", checkedAt: iso(now), whenLabel: "Checked", resultText: "Not set up, so it was not tested." };
  }
  const { run } = input;
  if (!run) {
    return { key, state: "unavailable", checkedAt: iso(now), whenLabel: "Tried", resultText: "The last test result could not be read." };
  }
  const outcome = run.summary?.outcome;
  const at = latest(run);
  if (run.status === "never" || !at || typeof outcome !== "string") {
    return { key, state: "unavailable", checkedAt: null, whenLabel: "Tested", noTimeLabel: "Never", resultText: "Not tested yet. Press Test connections." };
  }
  const ms = num(run.summary, "ms");
  const common = { key, checkedAt: at, whenLabel: "Tested" };
  const old = now.getTime() - new Date(at).getTime() > REACHABILITY_STALE_AFTER_MS;
  if (outcome === "reachable") {
    const text = `${words.name} answered a read-only test${ms !== null ? ` in ${ms} ms` : ""}. Nothing was sent or changed.`;
    return old ? { ...common, state: "watch", resultText: `${text} That was over 24 hours ago. Test again.` } : { ...common, state: "ok", resultText: text };
  }
  if (outcome === "refused") {
    return { ...common, state: "attention", resultText: `${words.refused}${old ? " That was over 24 hours ago. Test again." : ""}` };
  }
  return { ...common, state: "unavailable", whenLabel: "Tried", resultText: `${words.name} did not answer in time or could not be reached.${old ? " That was over 24 hours ago. Test again." : ""}` };
}

/* ---------- Host jobs (#1382): the server's own timers report one run each ---------- */

const NOT_REPORTING = "Not reporting yet: the server has not sent a run. Setting the heartbeat token on the server turns this on (deploy guide).";

type HostJob = {
  name: string;
  /** Plain reason for each failing result word. */
  failures: Record<string, string>;
  /** Text for a failing run whose result word is missing or unknown. */
  failureFallback: string;
  stale: string;
};

function hostProblem(job: HostJob, key: string, run: JobRun, readAt: Date): Fields | null {
  if (run.status === "never") {
    return { key, state: "unavailable", checkedAt: iso(readAt), whenLabel: "Tried", resultText: NOT_REPORTING };
  }
  if (run.status === "failing") {
    const result = run.summary?.result;
    const reason = (typeof result === "string" && job.failures[result]) || job.failureFallback;
    return { key, state: "attention", checkedAt: run.lastFailedAt, whenLabel: "Last failure", resultText: reason };
  }
  if (run.status === "stale") {
    return { key, state: "watch", checkedAt: run.lastSucceededAt, whenLabel: "Last success", resultText: job.stale };
  }
  return null;
}

const NO_COUNTS = "It ran, but its counts were not recorded.";

const AUTODEPLOY: HostJob = {
  name: "auto-deploy",
  failures: {
    "deploy-failed": "The latest deploy failed; the live version kept running.",
    "fetch-failed": "The server could not check GitHub for a new version. It will try again.",
    "failed-commit-held": "The newest version failed to deploy earlier and is being held back. A newer version is needed.",
    "no-owner": "The site folder on the server has no known owner, so nothing was checked or deployed.",
    "fast-forward-failed": "The server could not move its copy of the code to the new version; nothing was deployed.",
  },
  failureFallback: "The latest auto-deploy run failed. Check the server.",
  stale: "No successful auto-deploy check in over 30 minutes. The server's two-minute deploy timer may have stopped.",
};

const AUTODEPLOY_OK: Record<string, string> = {
  "up-to-date": "Up to date.",
  "outside-window": "A new version is waiting for the night deploy window.",
  "image-pending": "Waiting for the new version's image.",
  deployed: "Deployed a new version.",
};

export function autodeployFields(key: string, run: JobRun, readAt: Date): Fields {
  const problem = hostProblem(AUTODEPLOY, key, run, readAt);
  if (problem) return problem;
  const result = run.summary?.result;
  const text = typeof result === "string" ? AUTODEPLOY_OK[result] : undefined;
  if (!text) return { key, state: "watch", checkedAt: run.lastSucceededAt, whenLabel: "Last success", resultText: NO_COUNTS };
  return { key, state: "ok", checkedAt: run.lastSucceededAt, whenLabel: "Last success", resultText: text };
}

const CLEANUP: HostJob = {
  name: "Docker cleanup",
  failures: {},
  failureFallback: "The latest Docker cleanup failed. Check the server.",
  stale: "No successful Docker cleanup in over 30 hours. The daily cleanup timer may have stopped, and the disk can fill up.",
};

export function dockerCleanupFields(key: string, run: JobRun, readAt: Date): Fields {
  const problem = hostProblem(CLEANUP, key, run, readAt);
  if (problem) return problem;
  if (run.summary?.result === "skipped-lock-busy") {
    return { key, state: "watch", checkedAt: run.lastSucceededAt, whenLabel: "Last success", resultText: "Skipped: a deploy was running. It runs again tomorrow." };
  }
  const after = num(run.summary, "diskUsedAfterPct");
  const removed = num(run.summary, "imagesRemoved");
  if (run.summary?.result !== "cleaned" || after === null || removed === null) {
    return { key, state: "watch", checkedAt: run.lastSucceededAt, whenLabel: "Last success", resultText: NO_COUNTS };
  }
  const text = `Disk ${after}% used after cleanup; ${removed} ${removed === 1 ? "image" : "images"} removed.`;
  return { key, state: "ok", checkedAt: run.lastSucceededAt, whenLabel: "Last success", resultText: text };
}

const GUARD: HostJob = {
  name: "runtime guard",
  failures: { failed: "The latest check found the app container missing its settings and could not restore them. Check the server." },
  failureFallback: "The latest runtime guard run failed. Check the server.",
  stale: "No successful runtime guard check in over 15 minutes. Its timer on the server may have stopped.",
};

export function runtimeGuardFields(key: string, run: JobRun, readAt: Date): Fields {
  const problem = hostProblem(GUARD, key, run, readAt);
  if (problem) return problem;
  if (run.summary?.result !== "ok") {
    return { key, state: "watch", checkedAt: run.lastSucceededAt, whenLabel: "Last success", resultText: NO_COUNTS };
  }
  return { key, state: "ok", checkedAt: run.lastSucceededAt, whenLabel: "Last success", resultText: "The app container has its settings." };
}
