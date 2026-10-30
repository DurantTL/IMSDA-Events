import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: vi.fn() }));

import { clubEditWindow, quotedClosingDate, type ClubEvent } from "@/modules/club-registrations/repository";

const event = {
  id: "evt_1",
  slug: "synthetic-camp",
  name: "Synthetic Camp",
  startsAt: new Date("2027-10-08T12:00:00.000Z"),
  endsAt: new Date("2027-10-10T22:00:00.000Z"),
  timezone: "America/Chicago",
  location: "Camp",
  isPublished: true,
  archivedAt: null,
  lifecycleState: null,
  registrationOpensOn: "2027-05-01",
  registrationClosesOn: "2027-10-01",
  waitlistEnabled: false,
  billingMode: "DEFERRED_ORGANIZATION_INVOICE",
  supportContact: null,
} as unknown as ClubEvent;
const now = new Date("2027-07-15T12:00:00.000Z");

describe("closing dates quoted to directors (#156)", () => {
  it("keeps the dated wording for a legacy event closed by its date", () => {
    const closedByDate = { ...event, registrationClosesOn: "2027-07-01" } as ClubEvent;
    expect(quotedClosingDate(closedByDate, null)).toBe("2027-07-01");
    expect(clubEditWindow(closedByDate, null, now)).toEqual({
      open: false,
      message: "Registration closed after July 1, 2027. Contact the event team to add or remove someone.",
    });
  });

  it("quotes no date when the state closes registration, even with the closing date still ahead", () => {
    for (const state of ["REGISTRATION_CLOSED", "COMPLETE", "FINANCIAL_RECONCILIATION", "CLOSED"] as const) {
      const closed = { ...event, lifecycleState: state } as ClubEvent;
      expect(quotedClosingDate(closed, null), state).toBeNull();
      const window = clubEditWindow(closed, null, now);
      expect(window.open).toBe(false);
      if (!window.open) expect(window.message, state).not.toMatch(/2027|after/);
    }
    expect(clubEditWindow({ ...event, lifecycleState: "REGISTRATION_CLOSED" } as ClubEvent, null, now))
      .toEqual({ open: false, message: "Registration closed. Contact the event team to add or remove someone." });
  });

  it("still quotes the date for published and in-progress events", () => {
    for (const state of [null, "PUBLISHED", "IN_PROGRESS"] as const) {
      expect(quotedClosingDate({ ...event, lifecycleState: state } as ClubEvent, null), String(state)).toBe("2027-10-01");
    }
  });
});
