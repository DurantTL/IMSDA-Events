import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reportReadLabel, reportTimeLabel } from "@/modules/system-admin/system-report/model";

/** B13: the System report shows times in Central, labeled, and "today" is the Central day. */
describe("System report times in Central (B13)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("labels a daylight time CDT and a standard time CST", () => {
    expect(reportReadLabel(new Date("2026-10-30T21:36:00.000Z"))).toBe("Friday, October 30, 2026 at 4:36 PM CDT");
    expect(reportReadLabel(new Date("2026-11-06T21:36:00.000Z"))).toBe("Friday, November 6, 2026 at 3:36 PM CST");
  });

  it("never prints UTC", () => {
    const now = new Date("2026-11-06T21:36:00.000Z");
    vi.setSystemTime(now);
    expect(reportTimeLabel(now.toISOString(), now)).not.toContain("UTC");
    expect(reportReadLabel(now)).not.toContain("UTC");
  });

  it("says today for a reading on the same Central day", () => {
    const now = new Date("2026-11-06T21:36:00.000Z");
    vi.setSystemTime(now);
    expect(reportTimeLabel("2026-11-06T15:00:00.000Z", now)).toBe("9:00 AM CST today");
  });

  it("uses the Central day near midnight UTC: 02:30 UTC on Nov 7 is still Nov 6 in Chicago", () => {
    const now = new Date("2026-11-07T02:30:00.000Z");
    vi.setSystemTime(now);
    expect(reportReadLabel(now)).toBe("Friday, November 6, 2026 at 8:30 PM CST");
    // Same UTC day as now, but the previous Central day.
    expect(reportTimeLabel("2026-11-07T00:10:00.000Z", now)).toBe("6:10 PM CST today");
    // Previous UTC day, same Central day.
    expect(reportTimeLabel("2026-11-06T18:00:00.000Z", now)).toBe("12:00 PM CST today");
  });

  it("carries the date for an earlier Central day, even when it is the same UTC day", () => {
    const now = new Date("2026-11-07T07:30:00.000Z");
    vi.setSystemTime(now);
    // 05:30 UTC Nov 7 is 11:30 PM Nov 6 in Chicago; now is 1:30 AM Nov 7 in Chicago.
    expect(reportTimeLabel("2026-11-07T05:30:00.000Z", now)).toBe("Nov 6, 2026, 11:30 PM CST");
  });

  it("handles a missing or invalid reading", () => {
    const now = new Date("2026-11-06T21:36:00.000Z");
    expect(reportTimeLabel(null, now)).toBe("Not recorded");
    expect(reportTimeLabel("not a date", now)).toBe("Not recorded");
  });
});

describe("the other System report time stamps are Central too (B13)", () => {
  it("prints the notice stamps in Central", async () => {
    const { squareNoticeFields, rejectedNoticeFields } = await import("@/modules/system-admin/system-report/notice-signals");
    const now = new Date("2026-11-07T03:00:00.000Z");
    const last = squareNoticeFields("k", { configured: true, lastNoticeAt: new Date("2026-11-07T02:30:00.000Z"), newestPaymentAt: null, ignoredCount: 0, now });
    expect(last.resultText).toContain("Nov 6, 2026, 8:30 PM CST");
    expect(last.resultText).not.toContain("UTC");
    const rejected = rejectedNoticeFields("k", { squareRejectedAt: new Date("2026-10-30T22:00:00.000Z"), resendRejectedAt: null, active: "Amazon SES" as never, alertDeliveryConfigured: true, now });
    expect(rejected.resultText).toContain("Oct 30, 2026, 5:00 PM CDT");
    expect(rejected.resultText).not.toContain("UTC");
  });

  it("prints the backup stamp in Central", async () => {
    const { formatBackupTime } = await import("@/modules/operations/offsite-backups");
    expect(formatBackupTime("2026-11-07T03:12:00.000Z")).toBe("Nov 6, 2026, 9:12 PM CST");
  });
});
