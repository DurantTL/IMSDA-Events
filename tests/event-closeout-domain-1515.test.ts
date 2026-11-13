import { describe, expect, it } from "vitest";
import {
  buildCloseoutChecklist,
  checkLabels,
  closeoutCheckIds,
  closeoutSnapshot,
  openChecksSignature,
  parseCloseoutCheckedAt,
  parseCloseoutSnapshot,
  sameOpenChecks,
  storedCloseoutSnapshot,
  signoffRefusal,
  summarizeCloseout,
  type CloseoutFacts,
} from "@/modules/events/closeout-domain";

const tally = (count = 0, cents = 0) => ({ count, cents });
const cleanFacts = (overrides: Partial<CloseoutFacts> = {}): CloseoutFacts => ({
  eventId: "evt_1",
  report: {
    check: { outstandingMatches: true, paymentLinesAddUp: true, everyRegistrationPaidMatches: true, ok: true },
    uncountedPayments: { PENDING: tally(), FAILED: tally(), VOIDED: tally() },
    uncountedRefunds: { PENDING: tally(), FAILED: tally() },
    outstandingCents: 0,
    overpaidCreditCents: 0,
    owing: [],
  },
  churchBilled: false,
  draftInvoices: 0,
  failedMessages: 0,
  waitlistWaiting: 0,
  square: { state: "ok", count: 0, cents: 0 },
  closedMoneyReviews: { count: 0, cents: 0 },
  ...overrides,
});
const withReport = (change: Partial<NonNullable<CloseoutFacts["report"]>>) => cleanFacts({ report: { ...cleanFacts().report!, ...change } });
const stateOf = (facts: CloseoutFacts, id: (typeof closeoutCheckIds)[number]) => buildCloseoutChecklist(facts).find((check) => check.id === id)!;

describe("the closeout checklist (#1515)", () => {
  it("lists every check once, with a plain sentence and a link that names the event", () => {
    const checks = buildCloseoutChecklist(cleanFacts());
    expect(checks.map((check) => check.id)).toEqual([...closeoutCheckIds]);
    for (const check of checks) {
      expect(check.sentence.length, check.id).toBeGreaterThan(10);
      expect(check.href, check.id).toContain("event=evt_1");
      expect(check.label, check.id).toBe(checkLabels[check.id]);
    }
    expect(checks.every((check) => check.state === "ready")).toBe(true);
    expect(summarizeCloseout(checks)).toEqual({ blocking: 0, warning: 0, ready: 12, canSignOff: true });
  });

  it("blocks when the money report does not add up", () => {
    const check = stateOf(withReport({ check: { outstandingMatches: false, paymentLinesAddUp: true, everyRegistrationPaidMatches: true, ok: false } }), "money-reconciliation");
    expect(check).toMatchObject({ state: "blocking", href: "/finance/money-report?event=evt_1", linkAccess: "report" });
  });

  it.each([
    ["pending-payments", { uncountedPayments: { PENDING: tally(2, 3000), FAILED: tally(), VOIDED: tally() } }, "blocking", 2, 3000],
    ["pending-refunds", { uncountedRefunds: { PENDING: tally(1, 1000), FAILED: tally() } }, "blocking", 1, 1000],
    ["failed-refunds", { uncountedRefunds: { PENDING: tally(), FAILED: tally(3, 4500) } }, "blocking", 3, 4500],
    ["failed-payments", { uncountedPayments: { PENDING: tally(), FAILED: tally(1, 500), VOIDED: tally() } }, "warning", 1, 500],
  ] as const)("%s: one is enough, and the count and amount come from the report", (id, change, state, count, cents) => {
    const check = stateOf(withReport(change), id);
    expect(check).toMatchObject({ state, count, cents });
    expect(check.sentence).toContain("$");
  });

  it("does not count voided payments at all", () => {
    expect(summarizeCloseout(buildCloseoutChecklist(withReport({ uncountedPayments: { PENDING: tally(), FAILED: tally(), VOIDED: tally(4, 9900) } })))).toMatchObject({ blocking: 0, warning: 0 });
  });

  it("warns on balances still owed with the count and the total, and on overpaid credit", () => {
    const owing = [{} as never, {} as never];
    const balances = stateOf(withReport({ owing, outstandingCents: 12_550 }), "outstanding-balances");
    expect(balances).toMatchObject({ state: "warning", count: 2, cents: 12_550 });
    expect(balances.sentence).toContain("$125.50");
    expect(stateOf(withReport({ overpaidCreditCents: 2000 }), "overpaid-credit")).toMatchObject({ state: "warning", cents: 2000 });
    expect(stateOf(withReport({ overpaidCreditCents: 0 }), "overpaid-credit").state).toBe("ready");
  });

  it("blocks on draft church invoices only for a church-billed event", () => {
    expect(stateOf(cleanFacts({ churchBilled: true, draftInvoices: 2 }), "draft-invoices")).toMatchObject({ state: "blocking", count: 2 });
    expect(stateOf(cleanFacts({ churchBilled: true, draftInvoices: 0 }), "draft-invoices").state).toBe("ready");
    expect(stateOf(cleanFacts({ churchBilled: false, draftInvoices: 5 }), "draft-invoices")).toMatchObject({ state: "ready", count: 0 });
  });

  it("warns on failed messages and on people still waiting", () => {
    expect(stateOf(cleanFacts({ failedMessages: 1 }), "failed-messages")).toMatchObject({ state: "warning", count: 1, href: "/communications?event=evt_1", linkAccess: "event" });
    expect(stateOf(cleanFacts({ waitlistWaiting: 4 }), "waitlist")).toMatchObject({ state: "warning", count: 4 });
  });

  it("warns on unmatched Square payments, and never reads Square that was not checked as ready", () => {
    expect(stateOf(cleanFacts({ square: { state: "ok", count: 2, cents: 7500 } }), "unmatched-square")).toMatchObject({ state: "warning", count: 2, cents: 7500 });
    expect(stateOf(cleanFacts({ square: { state: "ok", count: 0, cents: 0 } }), "unmatched-square").state).toBe("ready");
    const notSetUp = stateOf(cleanFacts({ square: { state: "notConfigured" } }), "unmatched-square");
    expect(notSetUp).toMatchObject({ state: "warning", count: null });
    expect(notSetUp.sentence).toMatch(/not set up/);
    expect(notSetUp.sentence).toContain("Ask the system administrator to set it up");
    const down = stateOf(cleanFacts({ square: { state: "unavailable" } }), "unmatched-square");
    expect(down).toMatchObject({ state: "warning", count: null });
    expect(down.sentence).toMatch(/could not be reached/);
  });

  it("never turns an unreadable value into ready: a blocking check stays blocking, a warning check stays a warning", () => {
    const blind = buildCloseoutChecklist(cleanFacts({ report: null, draftInvoices: null, failedMessages: null, waitlistWaiting: null, closedMoneyReviews: null, churchBilled: true }));
    const states = Object.fromEntries(blind.map((check) => [check.id, check.state]));
    expect(states).toMatchObject({
      "money-reconciliation": "blocking", "pending-payments": "blocking", "pending-refunds": "blocking", "failed-refunds": "blocking", "draft-invoices": "blocking", "closed-event-money": "blocking",
      "outstanding-balances": "warning", "overpaid-credit": "warning", "failed-payments": "warning", "failed-messages": "warning", waitlist: "warning",
    });
    for (const check of blind.filter((entry) => entry.id !== "unmatched-square")) {
      expect(check.count, check.id).toBeNull();
      expect(check.sentence, check.id).toMatch(/could not be checked/);
    }
    expect(summarizeCloseout(blind).canSignOff).toBe(false);
  });

  it("blocks while money Square recorded after the close is not marked reviewed, and links to the list on the Closeout page", () => {
    const open = stateOf(cleanFacts({ closedMoneyReviews: { count: 2, cents: 7500 } }), "closed-event-money");
    expect(open).toMatchObject({ state: "blocking", count: 2, cents: 7500, label: "Money recorded while closed", linkAccess: "page" });
    expect(open.href).toBe("/finance/closeout?event=evt_1#closeout-closed-money");
    expect(open.sentence).toContain("$75.00");
    expect(stateOf(cleanFacts({ closedMoneyReviews: { count: 0, cents: 0 } }), "closed-event-money").state).toBe("ready");
    expect(summarizeCloseout(buildCloseoutChecklist(cleanFacts({ closedMoneyReviews: { count: 1, cents: 100 } }))).canSignOff).toBe(false);
  });

  it("an unreadable draft-invoice count on an event with no church billing is not an error, a church-billed one is", () => {
    expect(stateOf(cleanFacts({ churchBilled: false, draftInvoices: null }), "draft-invoices").state).toBe("ready");
    expect(stateOf(cleanFacts({ churchBilled: true, draftInvoices: null }), "draft-invoices").state).toBe("blocking");
  });
});

describe("the sign-off decision", () => {
  const checks = (facts: CloseoutFacts) => summarizeCloseout(buildCloseoutChecklist(facts));

  it("refuses any blocking check, acknowledged or not", () => {
    const blocked = checks(withReport({ uncountedRefunds: { PENDING: tally(1, 100), FAILED: tally() } }));
    expect(blocked.canSignOff).toBe(false);
    expect(signoffRefusal(blocked, true)).toMatchObject({ code: "BLOCKING_CHECKS" });
  });

  it("needs warnings acknowledged, and a clear checklist needs no tick", () => {
    const warned = checks(cleanFacts({ waitlistWaiting: 1 }));
    expect(signoffRefusal(warned, false)).toMatchObject({ code: "WARNINGS_NOT_ACKNOWLEDGED" });
    expect(signoffRefusal(warned, true)).toBeNull();
    expect(signoffRefusal(checks(cleanFacts()), false)).toBeNull();
  });
});

describe("the stored snapshot", () => {
  it("keeps ids, states, counts and cents only", () => {
    const snapshot = closeoutSnapshot(buildCloseoutChecklist(cleanFacts({ waitlistWaiting: 3 })));
    expect(snapshot).toHaveLength(12);
    for (const row of snapshot) expect(Object.keys(row).sort()).toEqual(["cents", "count", "id", "state"]);
    expect(JSON.stringify(snapshot)).not.toMatch(/evt_1|\/finance|waiting on/);
  });

  it("reads back what it wrote and drops anything malformed", () => {
    const snapshot = closeoutSnapshot(buildCloseoutChecklist(cleanFacts({ waitlistWaiting: 3 })));
    expect(parseCloseoutSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot);
    expect(parseCloseoutSnapshot([{ id: "nope", state: "ready" }, { id: "waitlist", state: "odd" }, null, "x", { id: "waitlist", state: "warning", count: "3", cents: 5 }]))
      .toEqual([{ id: "waitlist", state: "warning", count: null, cents: 5 }]);
    expect(parseCloseoutSnapshot("nothing")).toEqual([]);
  });
});

describe("the open set the signer saw (#1515)", () => {
  it("lists the checks that are not ready as sorted id:state:count:cents, and compares sets regardless of order", () => {
    const checks = buildCloseoutChecklist(cleanFacts({ waitlistWaiting: 2, failedMessages: 1, report: { ...cleanFacts().report!, uncountedRefunds: { PENDING: tally(1, 100), FAILED: tally() } } }));
    const open = openChecksSignature(checks);
    expect(open).toEqual(["failed-messages:warning:1:-", "pending-refunds:blocking:1:100", "waitlist:warning:2:-"]);
    expect(sameOpenChecks(open, [...open].reverse())).toBe(true);
    expect(sameOpenChecks(open, open.slice(1))).toBe(false);
    expect(sameOpenChecks(open, [...open.slice(1), "waitlist:blocking:2:-"])).toBe(false);
    // The same checks with bigger numbers than the signer saw are a different list.
    const grown = openChecksSignature(buildCloseoutChecklist(cleanFacts({ waitlistWaiting: 6, failedMessages: 1, report: { ...cleanFacts().report!, uncountedRefunds: { PENDING: tally(1, 100), FAILED: tally() } } })));
    expect(sameOpenChecks(open, grown)).toBe(false);
    expect(openChecksSignature(buildCloseoutChecklist(cleanFacts()))).toEqual([]);
  });

  it("stores the checks with the time they were read, and reads both back", () => {
    const stored = storedCloseoutSnapshot(buildCloseoutChecklist(cleanFacts({ waitlistWaiting: 1 })), new Date("2027-03-01T15:00:00.000Z"));
    expect(stored.checkedAt).toBe("2027-03-01T15:00:00.000Z");
    const roundTrip = JSON.parse(JSON.stringify(stored));
    expect(parseCloseoutCheckedAt(roundTrip)).toBe("2027-03-01T15:00:00.000Z");
    expect(parseCloseoutSnapshot(roundTrip)).toEqual(stored.checks);
    expect(parseCloseoutCheckedAt(stored.checks)).toBeNull();
  });
});
