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
