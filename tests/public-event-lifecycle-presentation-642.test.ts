import { describe, expect, it } from "vitest";
import { describePublicEventLifecycle } from "@/modules/events/public-domain";

const baseEvent = {
  isPublished: true, archivedAt: null,
  timezone: "America/Chicago",
  capacity: 100,
  registrationOpensOn: "2026-08-01",
  registrationClosesOn: "2026-09-30",
  waitlistEnabled: true,
};

describe("one lifecycle presentation per state (#642)", () => {
  const openAt = new Date("2026-08-01T18:00:00.000Z");
  const rendered = (summary: ReturnType<typeof describePublicEventLifecycle>) => JSON.stringify(summary);

  it("UPCOMING says when registration opens, once, and offers Add to my calendar", () => {
    const summary = describePublicEventLifecycle(baseEvent, 10, new Date("2026-07-31T18:00:00.000Z"));
    expect(summary.statusLabel).toBe("Registration opens tomorrow");
    expect(summary.detail).toContain("August 1, 2026");
    expect(summary).toMatchObject({ action: "ADD_TO_CALENDAR", ctaLabel: "Add to my calendar", ctaEnabled: false, ended: false });
  });

  it("UPCOMING for a club event says club registration", () => {
    const summary = describePublicEventLifecycle({ ...baseEvent, audience: "CLUB" }, 10, new Date("2026-07-31T18:00:00.000Z"));
    expect(summary.statusLabel).toBe("Club registration opens tomorrow");
  });

  it("OPEN shows forms guidance and the remaining capacity", () => {
    const summary = describePublicEventLifecycle(baseEvent, 96, openAt);
    expect(summary.state).toBe("OPEN");
    expect(summary.detail).toContain("4 spots currently remain.");
    expect(summary).toMatchObject({ action: "REGISTER", ctaLabel: "Register", statusLabel: "Registration open" });
    expect(summary.remainingSpots).toBe(4);
  });

  it("OPEN with no forms listed does not say registration is open", () => {
    const summary = describePublicEventLifecycle(baseEvent, 96, openAt, false);
    expect(summary).toMatchObject({
      state: "OPEN",
      statusLabel: "Registration opening soon",
      ctaEnabled: false,
      action: "ADD_TO_CALENDAR",
    });
    expect(rendered(summary)).not.toContain("Registration open\"");
    expect(rendered(summary)).not.toContain("Register\"");
  });

  it("OPEN without a capacity limit lists none", () => {
    const summary = describePublicEventLifecycle({ ...baseEvent, capacity: null }, 96, openAt);
    expect(summary.detail).not.toContain("remain");
    expect(summary.remainingSpots).toBeNull();
  });

  it("FULL without a waitlist says the event is full, not that forms are being prepared", () => {
    const summary = describePublicEventLifecycle({ ...baseEvent, waitlistEnabled: false }, 100, openAt);
    expect(summary).toMatchObject({ state: "FULL", statusLabel: "Event full", ctaLabel: "Event full", ctaEnabled: false });
    expect(summary.action).toBe("NONE");
    expect(rendered(summary)).not.toContain("being prepared");
  });

  it("WAITLIST keeps the call to action working", () => {
    const summary = describePublicEventLifecycle(baseEvent, 100, openAt);
    expect(summary).toMatchObject({ state: "WAITLIST", ctaLabel: "Join the waitlist", ctaEnabled: true });
    expect(summary.formsHeading).toBe("Join the waitlist");
    expect(summary.action).toBe("REGISTER");
    expect(rendered(summary)).not.toContain("being prepared");
  });

  it("CLOSED says so everywhere and shows no capacity number", () => {
    const summary = describePublicEventLifecycle(baseEvent, 80, new Date("2026-10-01T18:00:00.000Z"));
    expect(summary).toMatchObject({
      state: "CLOSED",
      statusLabel: "Registration closed",
      ctaLabel: "Registration closed",
      ctaEnabled: false,
      remainingSpots: null,
      ended: false,
    });
    expect(summary.action).toBe("NONE");
    expect(rendered(summary)).not.toContain("being prepared");
    expect(rendered(summary)).not.toContain("currently remain");
  });

  it("an ended event says so and shows no capacity number, even when full", () => {
    const summary = describePublicEventLifecycle(
      { ...baseEvent, endsAt: new Date("2026-09-15T20:00:00.000Z"), registrationClosesOn: null },
      100,
      new Date("2026-09-20T18:00:00.000Z"),
    );
    expect(summary).toMatchObject({
      state: "CLOSED",
      ended: true,
      statusLabel: "This event has ended",
      remainingSpots: null,
    });
    expect(summary.ctaLabel).toBe("This event has ended");
    expect(summary.action).toBe("NONE");
    expect(rendered(summary)).not.toContain("capacity has been reached");
  });

  it("an unpublished event reads as closed, not as being prepared", () => {
    const summary = describePublicEventLifecycle({ ...baseEvent, isPublished: false }, 0, openAt);
    expect(summary.state).toBe("CLOSED");
    expect(summary.remainingSpots).toBeNull();
    expect(summary.statusLabel).toBe("Registration closed");
  });

  it("a full event with a waitlist but no listed form offers no action yet", () => {
    const summary = describePublicEventLifecycle(baseEvent, 100, openAt, false);
    expect(summary).toMatchObject({ state: "WAITLIST", action: "NONE", ctaEnabled: false });
  });
});
