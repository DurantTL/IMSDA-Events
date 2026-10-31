import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { JobRun } from "@/modules/operations/sweep-heartbeat-repository";
import {
  alertDeliveryFields,
  alertScanFields,
  classWaitlistFields,
  deadlineReminderFields,
  healthSnapshotFields,
  honorWatchSummaryFields,
  instructorClassEmailFields,
  locationWaitlistDigestFields,
  retentionCleanupFields,
} from "@/modules/system-admin/system-report/job-signals";

/** #1377: the mappers for the remaining sweep steps. Synthetic data only. */

const now = new Date("2026-10-31T12:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
});
afterEach(() => vi.useRealTimers());

function run(overrides: Partial<JobRun>): JobRun {
  return { status: "ok", lastSucceededAt: minutesAgo(5), lastFailedAt: null, ageMs: 300_000, summary: null, ...overrides };
}
const never = run({ status: "never", lastSucceededAt: null, ageMs: null });
const failing = run({ status: "failing", lastFailedAt: minutesAgo(1) });
const stale = run({ status: "stale", lastSucceededAt: minutesAgo(120) });

type Mapper = (key: string, run: JobRun, readAt: Date) => ReturnType<typeof alertScanFields>;
const cases: Array<{ name: string; map: Mapper; good: JobRun["summary"]; goodText: string }> = [
  { name: "alert scan", map: alertScanFields, good: { sent: 1, suppressed: 2, undelivered: 0, cleared: 3 }, goodText: "1 sent, 2 held back, 0 not delivered, 3 cleared." },
  { name: "deadline reminders", map: deadlineReminderFields, good: { prepared: 2, updated: 1, withdrawn: 0 }, goodText: "2 prepared, 1 updated, 0 withdrawn. Nothing is emailed until a system administrator sends a batch." },
  { name: "location waitlist digest", map: locationWaitlistDigestFields, good: { status: "QUEUED", changesCovered: 4, recipients: 2, delivered: 2 }, goodText: "4 changes covered, 2 recipients, 2 delivered." },
  { name: "class waitlists", map: classWaitlistFields, good: { classes: 5, offered: 2, lapsed: 1, failed: 0, budgetExhausted: false }, goodText: "5 classes checked, 2 offered, 1 lapsed, 0 failed." },
  { name: "instructor class emails", map: instructorClassEmailFields, good: { status: "RAN", queued: 4, failed: 0, delivered: 3 }, goodText: "4 queued, 3 delivered, 0 failed." },
  { name: "honor watch summaries", map: honorWatchSummaryFields, good: { status: "RAN", watches: 4, queued: 3, failed: 0, delivered: 3 }, goodText: "4 watches, 3 queued, 3 delivered, 0 failed." },
  { name: "retention clean-ups", map: retentionCleanupFields, good: { community: 5, alertFeed: 6, analytics: 7 }, goodText: "Deleted 5 community posts, 6 alert feed items and 7 daily analytics rows past their keep time." },
  { name: "sealed health copies (on)", map: (k, r, a) => healthSnapshotFields(k, r, a, true), good: { enabled: true, taken: 6, sealFailed: 0, deleted: 4, heldSkipped: 2 }, goodText: "6 sealed, 0 failed to seal, 4 expired copies deleted, 2 kept for a legal hold." },
];

describe.each(cases)("$name", ({ map, good, goodText }) => {
  it("is OK with its counts after a good run", () => {
    expect(map("k", run({ summary: good }), now)).toMatchObject({ state: "ok", resultText: goodText, whenLabel: "Last success", checkedAt: minutesAgo(5) });
  });

  it("is unavailable, never OK, when it never reported", () => {
    const row = map("k", never, now);
    expect(row.state).toBe("unavailable");
    expect(row.resultText).toContain("Never reported");
  });

  it("is attention after a failed run and watch when it has not succeeded in an hour", () => {
    expect(map("k", failing, now).state).toBe("attention");
    expect(map("k", stale, now).state).toBe("watch");
  });

  it("is watch, not OK, when it ran but recorded no counts", () => {
    expect(map("k", run({ summary: null }), now)).toMatchObject({ state: "watch", resultText: "It ran, but its counts were not recorded." });
    expect(map("k", run({ summary: { status: "RAN", enabled: true } }), now).state).toBe("watch");
  });
});

describe("what makes a counted run a watch", () => {
  it("alert scan: an alert that was not delivered", () => {
    expect(alertScanFields("k", run({ summary: { sent: 0, suppressed: 0, undelivered: 2, cleared: 0 } }), now).state).toBe("watch");
  });
  it("class waitlists: a failed class, or running out of time", () => {
    expect(classWaitlistFields("k", run({ summary: { classes: 3, offered: 0, lapsed: 0, failed: 1, budgetExhausted: false } }), now).state).toBe("watch");
    expect(classWaitlistFields("k", run({ summary: { classes: 3, offered: 0, lapsed: 0, failed: 0, budgetExhausted: true } }), now).state).toBe("watch");
  });
  it("instructor emails and watch summaries: a failed email", () => {
    expect(instructorClassEmailFields("k", run({ summary: { status: "RAN", queued: 1, failed: 1, delivered: 0 } }), now).state).toBe("watch");
    expect(honorWatchSummaryFields("k", run({ summary: { status: "RAN", watches: 1, queued: 0, failed: 1, delivered: 0 } }), now).state).toBe("watch");
  });
  it("health copies: a copy that failed to seal", () => {
    expect(healthSnapshotFields("k", run({ summary: { enabled: true, taken: 1, sealFailed: 1, deleted: 0, heldSkipped: 0 } }), now, true).state).toBe("watch");
  });
  it("retention: a clean-up that recorded null is not counted as zero", () => {
    expect(retentionCleanupFields("k", run({ summary: { community: 5, alertFeed: null, analytics: 7 } }), now).state).toBe("watch");
  });
});

describe("location waitlist digest statuses", () => {
  const digest = (status: string) => locationWaitlistDigestFields("k", run({ summary: { status, changesCovered: 0, recipients: 0, delivered: 0 } }), now);
  it("reads not due and no changes as OK", () => {
    expect(digest("NOT_DUE").state).toBe("ok");
    expect(digest("NO_CHANGES").state).toBe("ok");
  });
  it("reads switched off as a count-only note and missing email setup as watch", () => {
    expect(digest("SWITCHED_OFF").state).toBe("info");
    expect(digest("EMAIL_NOT_CONFIGURED")).toMatchObject({ state: "watch", resultText: "Changes are waiting because account email is not set up." });
  });
});

describe("a step switched off in the notification settings", () => {
  it("reads as a count-only note, not OK and not a problem", () => {
    expect(instructorClassEmailFields("k", run({ summary: { status: "SWITCHED_OFF", queued: 0, failed: 0, delivered: 0 } }), now).state).toBe("info");
    expect(honorWatchSummaryFields("k", run({ summary: { status: "SWITCHED_OFF", watches: 0, queued: 0, failed: 0, delivered: 0 } }), now).state).toBe("info");
  });
});

describe("sealed health copies with health records off", () => {
  it("reads Off as a count-only note from the live setting, whatever the last run says", () => {
    for (const r of [never, failing, stale, run({ summary: { enabled: false, taken: null, sealFailed: null, deleted: 0, heldSkipped: 0 } })]) {
      expect(healthSnapshotFields("k", r, now, false)).toMatchObject({ state: "info", resultText: "Off. Health records are switched off, so no health copies are sealed." });
    }
  });
});

describe("alert delivery", () => {
  const fields = (input: { configured: boolean; run: JobRun | null }) => alertDeliveryFields("alert-delivery", input, now);

  it("says Not set up (watch) when there is no webhook, like the connection tests", () => {
    expect(fields({ configured: false, run: null })).toMatchObject({ state: "watch", resultText: "Not set up, so alerts are only written to the app logs." });
  });

  it("is unavailable with the time Never, not OK, when set up but no alert has needed sending", () => {
    expect(fields({ configured: true, run: never })).toMatchObject({
      state: "unavailable", checkedAt: null, noTimeLabel: "Never", resultText: "No alert has needed sending yet, so delivery has not been proved.",
    });
  });

  it("is unavailable when the stored result cannot be read", () => {
    expect(fields({ configured: true, run: null }).state).toBe("unavailable");
  });

  it("is OK after a delivered alert and is never judged stale, however old", () => {
    const old = run({ status: "ok", lastSucceededAt: minutesAgo(60 * 24 * 40), summary: { outcome: "delivered", status: 200 } });
    expect(fields({ configured: true, run: old })).toMatchObject({ state: "ok", resultText: "The latest alert reached the webhook." });
    // Even a "stale" reading from the one-hour rule is ignored: only the failing status matters.
    expect(fields({ configured: true, run: { ...old, status: "stale" } }).state).toBe("ok");
  });

  it("is attention when the latest delivery failed, with the status number or unreachable, and no address", () => {
    const refused = fields({ configured: true, run: run({ status: "failing", lastFailedAt: minutesAgo(3), summary: { outcome: "refused", status: 502 } }) });
    expect(refused.state).toBe("attention");
    expect(refused.resultText).toContain("HTTP 502");
    const unreachable = fields({ configured: true, run: run({ status: "failing", lastFailedAt: minutesAgo(3), summary: { outcome: "unreachable", status: null } }) });
    expect(unreachable.state).toBe("attention");
    expect(unreachable.resultText).toContain("could not be reached");
    expect(fields({ configured: true, run: run({ status: "failing", lastFailedAt: minutesAgo(3), summary: null }) }).state).toBe("attention");
  });
});

describe("sealed health copies when the stored run cannot be read", () => {
  it("is unavailable when on, and still Off when off", () => {
    expect(healthSnapshotFields("k", null, now, true).state).toBe("unavailable");
    expect(healthSnapshotFields("k", null, now, false).state).toBe("info");
  });
});
