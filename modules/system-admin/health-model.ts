/**
 * The System home's health panel (#1183): pure presentation of what `getSystemHealth` and the attention summary
 * already measured. Nothing here measures anything, changes a threshold or reads the database. It only decides how a
 * reading is worded, and it keeps four states apart that the old panel blurred:
 *
 * - current: the reading was made when the page loaded, or the job reported recently.
 * - stale: the evidence is old, so it shows when it was last observed and does not read as live.
 * - partial: some of what the signal needs could not be read, so the number is a floor or may be missing items.
 * - unavailable: the read failed, was denied or never reported. That is "Unavailable", never Healthy and never 0.
 *
 * A zero is only ever shown when the read succeeded and counted none. Health is live evidence only: the implemented
 * screening behavior (#874), human sign-offs (#870) and remaining setup live on the System readiness page.
 */
import { SWEEP_STALE_AFTER_MS, type SweepHeartbeat } from "@/modules/operations/sweep-heartbeat";
import type { AttentionSummary } from "@/modules/system-admin/attention-model";
import { EMAIL_PROBLEM_WINDOW_DAYS } from "@/modules/system-admin/attention-model";
import { attentionValue, readTimeLabel } from "@/modules/system-admin/home-model";

export type HealthState = "ok" | "warn" | "bad" | "unknown";
export type HealthFreshness = "current" | "stale" | "partial" | "unavailable";

export type HealthSignalKey = "email-sweep" | "email-queue" | "open-alerts" | "email-delivery";

export type HealthSignal = {
  key: HealthSignalKey;
  name: string;
  /** What was checked, in one sentence. */
  checked: string;
  state: HealthState;
  /** The short result: "Running", "Unavailable", "Stale". */
  label: string;
  /** The result in words. */
  detail: string;
  freshness: HealthFreshness;
  /** ISO time the evidence was observed (for a job, its last success), or `null` when there is none. */
  observedAt: string | null;
  /** "When" line: states the observation time, or that there is none, and what stale or partial means. */
  when: string;
  /** Open alert summaries, shown under the alert signal. */
  items?: string[];
};

/** The shape `getSystemHealth` returns. Each part is `null` when its own read failed. */
export type SystemHealthRead = {
  sweep: SweepHeartbeat | null;
  outbox: {
    status: "ok" | "degraded";
    reasons: string[];
    pending: number;
    failed: number;
    processing: number;
  } | null;
  alerts: Array<{ key: string; summary: string }> | null;
};

export type HealthInput = {
  /** `null` when the whole health read failed or was denied. */
  health: SystemHealthRead | null;
  /** The dashboard's unresolved-alert count, or `null` when that read failed. */
  unresolvedAlertCount: number | null;
  /** The shared attention summary (which already carries its own read time), or `null` when it failed. */
  attention: AttentionSummary | null;
  /** When the page made its health reads. */
  readAt: string;
};

/** The alert read lists at most this many, so a full list is a floor. */
export const ALERT_LIST_LIMIT = 5;

export function agoLabel(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "less than a minute ago";
  if (minutes < 90) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hours ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/** The time of a reading, with its date whenever it falls on an earlier (UTC) day than the page read (`readAt`), so 7 PM yesterday never reads as later today. */
function timeWithDate(iso: string | null, readAt: string): string | null {
  const time = readTimeLabel(iso);
  if (!iso || !time) return null;
  const day = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });
  const date = day.format(new Date(iso));
  if (date === day.format(new Date(readAt))) return time;
  return `${date}, ${time}`;
}

/** The attention summary is cached for a short time, so its read time can be earlier than the page load: say when it was read. */
function readWhen(iso: string | null): string {
  const time = readTimeLabel(iso);
  return time ? `Read at ${time}.` : "Read time unknown.";
}

const NO_READING = "No reading was made, so this is not shown as healthy or as zero.";

function unavailable(key: HealthSignalKey, name: string, checked: string, why: string): HealthSignal {
  return {
    key,
    name,
    checked,
    state: "unknown",
    label: "Unavailable",
    detail: why,
    freshness: "unavailable",
    observedAt: null,
    when: `Not observed. ${NO_READING}`,
  };
}

function sweepSignal(sweep: SweepHeartbeat | null | undefined, health: SystemHealthRead | null, readAt: string): HealthSignal {
  const key = "email-sweep" as const;
  const name = "Email sweep";
  const checked = "Whether the scheduled email sweep has finished successfully in the last 15 minutes.";
  if (!health) return unavailable(key, name, checked, "System health could not be read just now.");
  if (!sweep) return unavailable(key, name, checked, "The last sweep time could not be read.");
  const last = sweep.lastSucceededAt;
  const lastTime = timeWithDate(last, readAt);
  if (sweep.status === "ok") {
    return {
      key, name, checked, state: "ok", label: "Running", freshness: "current", observedAt: last,
      detail: `Last succeeded ${agoLabel(sweep.ageMs ?? 0)}. Retries email, raises alerts, and prunes community content.`,
      when: `Last succeeded ${lastTime ?? "at an unknown time"}. ${readWhen(readAt)}`,
    };
  }
  if (sweep.status === "stale") {
    return {
      key, name, checked, state: "bad", label: "Stale: stopped?", freshness: "stale", observedAt: last,
      detail: `Last succeeded ${agoLabel(sweep.ageMs ?? 0)}. Failed email is not being retried and no alerts are raised until it runs again. Check the five-minute script on the server.`,
      when: `Stale. Last observed ${lastTime ?? "at an unknown time"}, more than 15 minutes before this page loaded. It does not show whether the job is running now.`,
    };
  }
  if (sweep.status === "failing") {
    const failedAt = sweep.lastFailedAt;
    const failedMs = failedAt ? Math.max(0, new Date(readAt).getTime() - new Date(failedAt).getTime()) : 0;
    const failedTime = timeWithDate(failedAt, readAt);
    const old = failedMs > SWEEP_STALE_AFTER_MS;
    return {
      key, name, checked, state: "bad", label: old ? "Failing (old reading)" : "Failing", freshness: old ? "stale" : "current", observedAt: failedAt,
      detail: `The latest sweep failed ${agoLabel(failedMs)}. Check the app logs for \u201cOutbox sweep failed\u201d.`,
      when: old
        ? `Stale. Latest failure ${failedTime ?? "at an unknown time"}, more than 15 minutes before this page loaded. It does not show whether the job is failing now.`
        : `Latest failure ${failedTime ?? "at an unknown time"}. ${readWhen(readAt)}`,
    };
  }
  return {
    key, name, checked, state: "warn", label: "Never reported", freshness: "unavailable", observedAt: null,
    detail: "No sweep has reported yet. Make sure the five-minute script posts to /api/internal/outbox/sweep.",
    when: "Not observed. No sweep has ever reported, so there is nothing to show as healthy.",
  };
}

function queueSignal(outbox: SystemHealthRead["outbox"] | undefined, health: SystemHealthRead | null, readAt: string): HealthSignal {
  const key = "email-queue" as const;
  const name = "Email queue";
  const checked = "How many messages are waiting in the email outbox and how many gave up after retries.";
  if (!health) return unavailable(key, name, checked, "System health could not be read just now.");
  if (!outbox) return unavailable(key, name, checked, "The email queue could not be read.");
  const counts = `${outbox.pending} waiting · ${outbox.failed} gave up after retries.`;
  if (outbox.status === "ok") {
    const empty = outbox.pending === 0 && outbox.failed === 0 && outbox.processing === 0;
    return {
      key, name, checked, state: "ok", label: "Flowing", freshness: "current", observedAt: readAt,
      detail: empty ? `${counts} The queue was read and is empty.` : counts,
      when: readWhen(readAt),
    };
  }
  return {
    key, name, checked, state: "warn", label: "Backing up", freshness: "current", observedAt: readAt,
    detail: `${outbox.reasons.join(". ")}. ${counts} A large announcement can cause this briefly.`,
    when: readWhen(readAt),
  };
}

function alertsSignal(
  alerts: SystemHealthRead["alerts"] | undefined,
  health: SystemHealthRead | null,
  unresolvedAlertCount: number | null,
  readAt: string,
): HealthSignal {
  const key = "open-alerts" as const;
  const name = "Open alerts";
  const checked = "Scan reports: alerts the scheduled scan has raised and is still reporting as unresolved.";
  if (!health) return unavailable(key, name, checked, "System health could not be read just now.");
  if (!alerts) return unavailable(key, name, checked, "Open alerts could not be read.");
  if (alerts.length === 0) {
    return {
      key, name, checked, state: "ok", label: "None", freshness: "current", observedAt: readAt,
      detail: "The alert list was read and the scan is reporting nothing unresolved.",
      when: readWhen(readAt),
    };
  }
  const full = alerts.length >= ALERT_LIST_LIMIT;
  // The count comes from the dashboard read. Without it a full list is only a floor.
  const known = unresolvedAlertCount !== null;
  const countText = known ? `${unresolvedAlertCount} open` : `${alerts.length}${full ? "+" : ""} open`;
  return {
    key, name, checked, state: "bad", label: countText, freshness: known || !full ? "current" : "partial", observedAt: readAt,
    detail: known
      ? "Cleared automatically once the condition is fixed."
      : `Cleared automatically once the condition is fixed.${full ? ` The total could not be read, so this is at least ${alerts.length} and only the first ${ALERT_LIST_LIMIT} are listed.` : ""}`,
    when: readWhen(readAt),
    items: alerts.map((alert) => alert.summary),
  };
}

function deliverySignal(attention: AttentionSummary | null): HealthSignal {
  const key = "email-delivery" as const;
  const name = "Email delivery problems";
  const checked = `Messages that failed, bounced or were marked as spam in the last ${EMAIL_PROBLEM_WINDOW_DAYS} days and not resent, and messages stuck in delivery.`;
  if (!attention) return unavailable(key, name, checked, "The delivery checks could not be read just now.");
  const failed = attentionValue(attention, "email-failed");
  const stuck = attentionValue(attention, "email-stuck");
  const observedAt = attention.generatedAt;
  if (failed === null && stuck === null) return unavailable(key, name, checked, "Neither delivery check could be read.");
  const parts = [
    failed === null ? "Failed email: unavailable." : `${failed} failed, bounced or spam-marked.`,
    stuck === null ? "Stuck email: unavailable." : `${stuck} stuck in delivery.`,
  ];
  const when = readWhen(observedAt);
  if (failed === null || stuck === null) {
    return {
      key, name, checked, state: "warn", label: "Partial", freshness: "partial", observedAt,
      detail: `${parts.join(" ")} The unread check is not counted as zero.`,
      when: `Partial. ${when}`,
    };
  }
  const problems = failed + stuck;
  return {
    key, name, checked, state: problems > 0 ? "bad" : "ok", label: problems > 0 ? `${problems} to look at` : "None found",
    freshness: "current", observedAt,
    detail: `${parts.join(" ")} These can overlap with the queue and alerts above, so the signals are not added together.`,
    when,
  };
}

/** The panel's rows. Each signal is built on its own, so one failed read never hides the others. */
export function buildHealthSignals({ health, unresolvedAlertCount, attention, readAt }: HealthInput): HealthSignal[] {
  return [
    sweepSignal(health?.sweep, health, readAt),
    queueSignal(health?.outbox, health, readAt),
    alertsSignal(health?.alerts, health, unresolvedAlertCount, readAt),
    deliverySignal(attention),
  ];
}

/** One line under the panel heading: what the reader can and cannot conclude from the rows. */
export function healthPanelNote(signals: readonly HealthSignal[]): string | null {
  const count = (freshness: HealthFreshness) => signals.filter((signal) => signal.freshness === freshness).length;
  const bits = [
    count("unavailable") > 0 ? `${count("unavailable")} unavailable` : null,
    count("stale") > 0 ? `${count("stale")} stale` : null,
    count("partial") > 0 ? `${count("partial")} partial` : null,
  ].filter((bit): bit is string => bit !== null);
  if (bits.length === 0) return null;
  return `Not every reading is complete: ${bits.join(", ")}. An unavailable, stale or partial reading is not a healthy one.`;
}
