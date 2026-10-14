import { describe, expect, it } from "vitest";
import * as coordinatorDomain from "@/modules/coordinator-health/domain";
import * as recordsDomain from "@/modules/health-records/domain";
import * as shared from "@/modules/events/health-window";

// Synthetic events only. All times are instants; the window is decided by the calendar day in the event's own time zone.

describe("the one shared event health window (#923)", () => {
  it("is a single definition: both modules re-export it rather than restating it", () => {
    expect(shared.HEALTH_WINDOW_DAYS).toBe(0);
    for (const domain of [coordinatorDomain, recordsDomain]) {
      expect(domain.HEALTH_WINDOW_DAYS).toBe(shared.HEALTH_WINDOW_DAYS);
      expect(domain.healthWindowEndsOn).toBe(shared.healthWindowEndsOn);
      expect(domain.healthWindowOpen).toBe(shared.healthWindowOpen);
    }
  });

  it("ends on the event's last day, in the event's time zone", () => {
    expect(shared.healthWindowEndsOn({ timezone: "America/Chicago", endsAt: new Date("2026-10-11T22:00:00Z") })).toBe("2026-10-11");
    // 10:30 pm Pacific on the 11th is already the 12th in UTC, but the event's day is still the 11th.
    expect(shared.healthWindowEndsOn({ timezone: "America/Los_Angeles", endsAt: new Date("2026-10-12T05:30:00Z") })).toBe("2026-10-11");
  });

  const event = { timezone: "America/Chicago", endsAt: new Date("2026-10-11T22:00:00Z") };

  it("is open before the event, during it, and on its last day through 11:59 pm", () => {
    expect(shared.healthWindowOpen(event, new Date("2026-09-01T12:00:00Z"))).toBe(true);
    expect(shared.healthWindowOpen(event, new Date("2026-10-09T12:00:00Z"))).toBe(true);
    expect(shared.healthWindowOpen(event, new Date("2026-10-11T12:00:00Z"))).toBe(true);
    // Even after the event's own end time, the last day stays open until midnight.
    expect(shared.healthWindowOpen(event, new Date("2026-10-12T04:59:00Z"))).toBe(true);
  });

  it("is closed from midnight at the start of the day after the last day, with no grace period", () => {
    expect(shared.healthWindowOpen(event, new Date("2026-10-12T05:00:00Z"))).toBe(false);
    expect(shared.healthWindowOpen(event, new Date("2026-10-13T12:00:00Z"))).toBe(false);
    // The old 30-day tail is gone.
    expect(shared.healthWindowOpen(event, new Date("2026-10-25T12:00:00Z"))).toBe(false);
    expect(shared.healthWindowOpen(event, new Date("2026-11-10T12:00:00Z"))).toBe(false);
  });

  it("holds across the autumn clock change (the last day is 25 hours long)", () => {
    // Central time falls back on 2026-11-01 at 2:00 am CDT (07:00Z). The event's last day is that Sunday.
    const fallBack = { timezone: "America/Chicago", endsAt: new Date("2026-11-01T20:00:00Z") };
    expect(shared.healthWindowEndsOn(fallBack)).toBe("2026-11-01");
    expect(shared.healthWindowOpen(fallBack, new Date("2026-11-01T06:30:00Z"))).toBe(true); // 1:30 am CDT
    expect(shared.healthWindowOpen(fallBack, new Date("2026-11-01T07:30:00Z"))).toBe(true); // 1:30 am CST, the repeated hour
    expect(shared.healthWindowOpen(fallBack, new Date("2026-11-02T05:59:00Z"))).toBe(true); // 11:59 pm CST
    expect(shared.healthWindowOpen(fallBack, new Date("2026-11-02T06:00:00Z"))).toBe(false); // midnight CST
  });

  it("holds across the spring clock change (the last day is 23 hours long)", () => {
    // Central time springs forward on 2026-03-08 at 2:00 am CST (08:00Z). The event's last day is that Sunday.
    const springForward = { timezone: "America/Chicago", endsAt: new Date("2026-03-08T15:00:00Z") };
    expect(shared.healthWindowEndsOn(springForward)).toBe("2026-03-08");
    expect(shared.healthWindowOpen(springForward, new Date("2026-03-08T07:59:00Z"))).toBe(true); // 1:59 am CST
    expect(shared.healthWindowOpen(springForward, new Date("2026-03-09T04:59:00Z"))).toBe(true); // 11:59 pm CDT
    expect(shared.healthWindowOpen(springForward, new Date("2026-03-09T05:00:00Z"))).toBe(false); // midnight CDT
  });

  it("closes a day earlier than UTC would for an event in a time zone behind UTC", () => {
    const hawaii = { timezone: "Pacific/Honolulu", endsAt: new Date("2026-10-11T20:00:00Z") };
    expect(shared.healthWindowOpen(hawaii, new Date("2026-10-12T09:59:00Z"))).toBe(true); // 11:59 pm HST on the 11th
    expect(shared.healthWindowOpen(hawaii, new Date("2026-10-12T10:00:00Z"))).toBe(false); // midnight HST
  });
});
