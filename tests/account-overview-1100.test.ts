import { describe, expect, it } from "vitest";
import { accountAmountDue, upcomingRegistrations } from "@/modules/attendee-accounts/account-overview";

type Row = Parameters<typeof upcomingRegistrations>[0][number];

function row(name: string, lifecycle: Row["lifecycle"], startsAt: string, endsAt: string, balanceCents = 0, paymentEligible = false): Row {
  return {
    lifecycle,
    balanceCents,
    payment: { state: "NOT_DUE", label: "", detail: "", paymentEligible },
    event: { name, startsAt, endsAt },
  };
}

const now = new Date("2026-10-23T12:00:00.000Z");

describe("account overview lifecycle (#1100)", () => {
  const cancelledEarlier = row("Cancelled Early", "CANCELLED", "2026-11-01T00:00:00Z", "2026-11-02T00:00:00Z");
  const waitlisted = row("Waitlisted Mid", "WAITLISTED", "2026-12-01T00:00:00Z", "2026-12-02T00:00:00Z");
  const confirmed = row("Confirmed Later", "CONFIRMED", "2027-01-01T00:00:00Z", "2027-01-02T00:00:00Z", 5000, true);
  const past = row("Past", "CONFIRMED", "2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z");

  it("never features a cancelled, draft or past registration as upcoming", () => {
    const draft = row("Draft", "DRAFT", "2026-11-05T00:00:00Z", "2026-11-06T00:00:00Z");
    const upcoming = upcomingRegistrations([cancelledEarlier, draft, past, confirmed], now);
    expect(upcoming.map((r) => r.event.name)).toEqual(["Confirmed Later"]);
  });

  it("keeps a waitlisted registration upcoming, in date order, with its own state", () => {
    const upcoming = upcomingRegistrations([confirmed, waitlisted, cancelledEarlier], now);
    expect(upcoming.map((r) => r.lifecycle)).toEqual(["WAITLISTED", "CONFIRMED"]);
  });

  it("sums only payable registrations and names the population", () => {
    const owing = row("Owing", "SUBMITTED", "2027-03-01T00:00:00Z", "2027-03-02T00:00:00Z", 2500, true);
    expect(accountAmountDue([cancelledEarlier, waitlisted, confirmed])).toMatchObject({ totalCents: 5000, scope: "for Confirmed Later" });
    expect(accountAmountDue([confirmed, owing])).toMatchObject({ totalCents: 7500, scope: "across 2 registrations" });
    expect(accountAmountDue([cancelledEarlier, waitlisted]).totalCents).toBe(0);
  });
});
