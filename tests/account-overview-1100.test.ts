import { describe, expect, it } from "vitest";
import { accountAmountDue, directBalanceCell, upcomingRegistrations } from "@/modules/attendee-accounts/account-overview";

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

describe("Balance cell text (#1100)", () => {
  const base = { balanceCents: 0, totalCents: 10000, grossPaidCents: 0, refundedCents: 0 };
  const pay = (state: string, label: string, paymentEligible = false) => ({ state: state as never, label, detail: "", paymentEligible });

  it("reads Paid in full for PAID", () => {
    expect(directBalanceCell({ ...base, grossPaidCents: 10000, payment: pay("PAID", "Paid in full") }))
      .toEqual({ main: "Paid in full \u00b7 $100.00", history: null });
  });

  it("reads the label with no history for NOT_DUE and nothing paid", () => {
    expect(directBalanceCell({ ...base, payment: pay("NOT_DUE", "No payment due while waitlisted") }))
      .toEqual({ main: "No payment due while waitlisted", history: null });
  });

  it("adds paid and refunded history for NOT_DUE with money paid", () => {
    const label = "No payment due on a cancelled registration";
    expect(directBalanceCell({ ...base, grossPaidCents: 10000, payment: pay("NOT_DUE", label) }))
      .toEqual({ main: label, history: "$100.00 paid" });
    expect(directBalanceCell({ ...base, grossPaidCents: 10000, refundedCents: 10000, payment: pay("NOT_DUE", label) }))
      .toEqual({ main: label, history: "$100.00 paid \u00b7 $100.00 refunded" });
  });

  it("reads the label for NO_PAYMENT_REQUIRED and the amount for a payable balance", () => {
    expect(directBalanceCell({ ...base, totalCents: 0, payment: pay("NO_PAYMENT_REQUIRED", "No payment required") }).main).toBe("No payment required");
    expect(directBalanceCell({ ...base, balanceCents: 6000, payment: pay("PARTIALLY_PAID", "Partial", true) }).main).toBe("$60.00 due of $100.00");
  });
});
