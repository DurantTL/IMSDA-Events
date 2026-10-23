import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  applyReviews, buildCloseout, closeoutCsv, closeoutExceptionsCsv, closeoutReviewInputSchema, openExceptionCount,
  type CloseoutInput, type CloseoutLedgerEntry, type CloseoutReview, type CloseoutSelection, type CloseoutTicket,
} from "@/modules/meals/closeout";
import { buildKitchenCountsReport, type KitchenCountEntry } from "@/modules/meals/kitchen-counts";
import { buildServedReport } from "@/modules/meals/served-report";

const DATE = "2026-10-15";
let counter = 0;
const id = (prefix: string) => `${prefix}${++counter}`;

function selection(over: Partial<CloseoutSelection> = {}): CloseoutSelection {
  return { id: id("sel"), mealType: "LUNCH", serviceDate: DATE, source: "REGISTRATION_FORM", payer: "ATTENDEE", status: "ACTIVE", quantity: 1, unitPriceCents: 800, conferenceRateCents: 0, ...over };
}
function entry(sel: CloseoutSelection, over: Partial<CloseoutLedgerEntry> = {}): CloseoutLedgerEntry {
  const amount = over.kind === "CREDIT" ? -(sel.quantity * sel.unitPriceCents) : sel.quantity * sel.unitPriceCents;
  return {
    id: id("led"), selectionId: sel.id, mealType: sel.mealType, serviceDate: sel.serviceDate, kind: "CHARGE", amountCents: amount, payer: sel.payer,
    settlement: "IN_REGISTRATION_PRICING", registrationAdjustmentId: null, ...over,
  };
}
function tickets(sel: CloseoutSelection, count = sel.quantity, cancelledFrom = Infinity): CloseoutTicket[] {
  return Array.from({ length: count }, (_, index) => ({ id: id("tkt"), number: counter, selectionId: sel.id, cancelled: index >= cancelledFrom }));
}
function kitchenEntries(lines: Array<[string, number]>): KitchenCountEntry[] {
  return lines.map(([kind, quantity], index) => ({
    id: `k${index}`, serviceDate: DATE, mealType: "LUNCH", kind: kind as KitchenCountEntry["kind"], quantity, note: null, enteredBy: "Kim", enteredAt: `2026-10-15T18:0${index}:00.000Z`, supersedesId: null,
  }));
}
const emptyKitchen = () => buildKitchenCountsReport(buildServedReport([], new Map()), []);

function input(over: Partial<CloseoutInput> = {}): CloseoutInput {
  return { selections: [], ledger: [], adjustments: [], tickets: [], served: new Set(), unredeemed: new Set(), anyImport: true, kitchen: emptyKitchen(), ...over };
}
const codes = (projection: ReturnType<typeof buildCloseout>) => projection.exceptions.map((exception) => exception.code);

describe("meal money closeout projection", () => {
  it("reconciles a clean event with no exceptions beyond the standing receipts note", () => {
    const paid = selection({ quantity: 2 });
    const t = tickets(paid);
    const projection = buildCloseout(input({
      selections: [paid], ledger: [entry(paid)], tickets: t, served: new Set(t.map((ticket) => ticket.id)),
      kitchen: buildKitchenCountsReport(buildServedReport([], new Map()), kitchenEntries([["PREPARED", 2]])),
    }));
    expect(projection.rows).toHaveLength(1);
    expect(projection.rows[0]).toMatchObject({ charges: 1600, credits: 0, net: 1600, ordered: { paid: 2 }, served: { paid: 2 }, kitchen: { prepared: 2, wasted: null } });
    expect(codes(projection)).toEqual(["RECEIPTS_NOT_ALLOCATED"]);
  });

  it("gives the same totals and digest for unchanged source data, in any record order", () => {
    const a = selection({ quantity: 2 });
    const b = selection({ source: "WALK_UP", mealType: "SUPPER" });
    const base = { selections: [a, b], ledger: [entry(a), entry(b, { settlement: "AT_COUNTER" })], tickets: [...tickets(a), ...tickets(b)] };
    const first = buildCloseout(input(base));
    const second = buildCloseout(input({ ...base, selections: [b, a], ledger: [...base.ledger].reverse(), tickets: [...base.tickets].reverse() }));
    expect(second.totals).toEqual(first.totals);
    expect(second.sources.digest).toBe(first.sources.digest);
    expect(second.exceptions.map((e) => e.key)).toEqual(first.exceptions.map((e) => e.key));
    const changed = buildCloseout(input({ ...base, ledger: [entry(a, { amountCents: 1 }), base.ledger[1]!] }));
    expect(changed.sources.digest).not.toBe(first.sources.digest);
  });

  it("keeps paid, complimentary, conference-paid, walk-up and cancelled-served meals apart, with no double counting", () => {
    const paid = selection();
    const comp = selection({ unitPriceCents: 0 });
    const conf = selection({ payer: "CONFERENCE", unitPriceCents: 0, conferenceRateCents: 500 });
    const walk = selection({ source: "WALK_UP" });
    const gone = selection({ status: "CANCELLED" });
    const all = [paid, comp, conf, walk, gone];
    const t = all.map((sel) => tickets(sel)[0]!);
    const projection = buildCloseout(input({
      selections: all, tickets: t, served: new Set(t.map((ticket) => ticket.id)),
      ledger: [
        entry(paid), entry(comp), entry(conf), entry(walk, { settlement: "AT_COUNTER" }),
        entry(gone), entry({ ...gone, status: "ACTIVE" }, { kind: "CREDIT", settlement: "REGISTRATION_NOT_LIVE" }),
      ],
    }));
    const row = projection.rows[0]!;
    expect(row.ordered).toEqual({ paid: 1, complimentary: 1, conference: 1, walkUp: 1 });
    expect(row.served).toEqual({ paid: 1, complimentary: 1, conference: 1, walkUp: 1 });
    expect(row.servedOnCancelled).toBe(1);
    expect(row.conferenceBilled).toBe(500);
    expect(row.net).toBe(800 + 0 + 0 + 800 + 800 - 800);
    expect(row.settlement.counter).toBe(800);
    expect(row.settlement.registrationNotLive).toBe(-800);
    expect(codes(projection)).toContain("SERVED_ON_CANCELLED");
    // The total is the sum of the rows, and nothing is counted in two buckets.
    expect(projection.totals.net).toBe(projection.rows.reduce((sum, r) => sum + r.net, 0));
  });

  it("bills conference meals for what was served, including after a later cancellation, and flags a missing rate", () => {
    const conf = selection({ payer: "CONFERENCE", unitPriceCents: 0, conferenceRateCents: 450, quantity: 3 });
    const noRate = selection({ payer: "CONFERENCE", unitPriceCents: 0, conferenceRateCents: 0, mealType: "SUPPER" });
    const t = tickets(conf, 3, 2); // the third ticket was cancelled afterwards
    const u = tickets(noRate);
    const projection = buildCloseout(input({
      selections: [conf, noRate], ledger: [entry(conf), entry(noRate)], tickets: [...t, ...u], served: new Set([...t, ...u].map((ticket) => ticket.id)),
    }));
    const lunch = projection.rows.find((row) => row.mealType === "LUNCH")!;
    expect(lunch).toMatchObject({ conferenceServed: 3, conferenceBilled: 1350, servedOnCancelled: 1 });
    const supper = projection.rows.find((row) => row.mealType === "SUPPER")!;
    expect(supper).toMatchObject({ conferenceServed: 1, conferenceBilled: 0, conferenceRateMissing: 1 });
    const missing = projection.exceptions.find((e) => e.code === "CONFERENCE_RATE_MISSING")!;
    expect(missing).toMatchObject({ category: "FINANCIAL", detail: { mealsWithoutRate: 1 } });
  });

  it("traces each registration-posted ledger line to a matching meal adjustment, and flags missing, different and orphan ones", () => {
    const sel = selection({ quantity: 2 });
    const good = entry(sel, { settlement: "REGISTRATION_ADJUSTMENT", registrationAdjustmentId: "adjGood" });
    const lone = selection();
    const missing = entry(lone, { settlement: "REGISTRATION_ADJUSTMENT", registrationAdjustmentId: null });
    const off = selection();
    const mismatch = entry(off, { settlement: "REGISTRATION_ADJUSTMENT", registrationAdjustmentId: "adjOff" });
    const projection = buildCloseout(input({
      selections: [sel, lone, off], ledger: [good, missing, mismatch],
      adjustments: [{ id: "adjGood", amountCents: 1600 }, { id: "adjOff", amountCents: 700 }, { id: "adjOrphan", amountCents: 300 }],
    }));
    expect(codes(projection).filter((code) => code.startsWith("ADJUSTMENT")).sort()).toEqual(["ADJUSTMENT_MISMATCH", "ADJUSTMENT_MISSING", "ADJUSTMENT_ORPHAN"]);
    const byCode = Object.fromEntries(projection.exceptions.map((e) => [e.code, e]));
    expect(byCode.ADJUSTMENT_MISMATCH!.detail).toMatchObject({ ledgerCents: 800, adjustmentCents: 700, differenceCents: -100 });
    expect(byCode.ADJUSTMENT_MISSING!.sourceIds).toContain(missing.id);
    expect(byCode.ADJUSTMENT_ORPHAN!.sourceIds).toEqual(["adjOrphan"]);
    // The good line raises nothing, and no source amount was altered.
    expect(projection.exceptions.some((e) => e.sourceIds.includes(good.id))).toBe(false);
    expect(projection.rows[0]!.settlement.registrationAdjustment).toBe(1600 + 800 + 800);
  });

  it("treats a selection with no ledger entries as missing source data, not as zero", () => {
    const sel = selection({ quantity: 3 });
    const free = selection({ unitPriceCents: 0 });
    const projection = buildCloseout(input({ selections: [sel, free] }));
    expect(codes(projection)).toEqual(["LEDGER_MISSING"]);
    expect(projection.exceptions[0]!.detail).toMatchObject({ expectedCents: 2400, ledgerCents: 0 });
    expect(projection.rows[0]!.net).toBe(0);
  });

  it("flags a ledger net that differs from the order, and a cancelled order whose credit is missing", () => {
    const sel = selection({ quantity: 2 });
    const cancelled = selection({ status: "CANCELLED" });
    const projection = buildCloseout(input({
      selections: [sel, cancelled], ledger: [entry(sel, { amountCents: 1500 }), entry(cancelled)],
    }));
    const mismatches = projection.exceptions.filter((e) => e.code === "LEDGER_MISMATCH");
    expect(mismatches.map((e) => e.detail)).toEqual(expect.arrayContaining([
      { expectedCents: 1600, ledgerCents: 1500, differenceCents: -100 },
      { expectedCents: 0, ledgerCents: 800, differenceCents: 800 },
    ]));
  });

  it("handles walk-up sales: counted at the counter, with the missing receipt record as an explicit exception", () => {
    const walk = selection({ source: "WALK_UP", quantity: 3 });
    const projection = buildCloseout(input({ selections: [walk], ledger: [entry(walk, { settlement: "AT_COUNTER" })], tickets: tickets(walk) }));
    expect(projection.rows[0]).toMatchObject({ net: 2400, settlement: { counter: 2400, inRegistration: 0 }, ordered: { walkUp: 3 } });
    expect(projection.exceptions.find((e) => e.code === "WALK_UP_RECEIPTS_NOT_RECORDED")).toMatchObject({ category: "FINANCIAL", detail: { walkUpNetCents: 2400, entries: 1 } });
    expect(codes(projection)).not.toContain("RECEIPTS_NOT_ALLOCATED");
  });

  it("raises count exceptions without touching served: not prepared, served over prepared, disposed over prepared", () => {
    const sel = selection({ quantity: 4 });
    const t = tickets(sel);
    const served = new Set(t.slice(0, 3).map((ticket) => ticket.id));
    const base = { selections: [sel], ledger: [entry(sel)], tickets: t, served };
    const none = buildCloseout(input(base));
    expect(codes(none)).toContain("PREPARED_MISSING");
    const over = buildCloseout(input({ ...base, kitchen: buildKitchenCountsReport(buildServedReport([], new Map()), kitchenEntries([["PREPARED", 2]])) }));
    expect(codes(over)).toContain("SERVED_EXCEEDS_PREPARED");
    expect(over.rows[0]!.served.paid).toBe(3);
    const waste = buildCloseout(input({ ...base, kitchen: buildKitchenCountsReport(buildServedReport([], new Map()), kitchenEntries([["PREPARED", 4], ["WASTED", 2], ["DONATED", 1]])) }));
    expect(codes(waste)).toContain("DISPOSED_EXCEEDS_PREPARED");
    expect(waste.exceptions.find((e) => e.code === "DISPOSED_EXCEEDS_PREPARED")!.detail).toMatchObject({ served: 3, wasted: 2, donated: 1, prepared: 4 });
    // Donated, wasted and transferred are not money.
    expect(waste.rows[0]!.net).toBe(none.rows[0]!.net);
    expect(waste.rows[0]!.kitchen).toEqual({ prepared: 4, wasted: 2, donated: 1, transferred: null });
  });

  it("flags tickets sold with no scanner import, and finance-only un-redeem corrections", () => {
    const sel = selection();
    const t = tickets(sel);
    const none = buildCloseout(input({ selections: [sel], ledger: [entry(sel)], tickets: t, anyImport: false }));
    expect(none.exceptions.find((e) => e.code === "NO_SCANNER_IMPORT")).toMatchObject({ category: "COUNT" });
    const undone = buildCloseout(input({ selections: [sel], ledger: [entry(sel)], tickets: t, unredeemed: new Set([t[0]!.id]) }));
    expect(undone.exceptions.find((e) => e.code === "UNREDEEM_ACCEPTED")).toMatchObject({ category: "PROTECTED_ACTION", detail: { tickets: 1 } });
  });

  it("reports a zero-meal event as empty with no exceptions and a zero total", () => {
    const projection = buildCloseout(input());
    expect(projection.rows).toEqual([]);
    expect(projection.exceptions).toEqual([]);
    expect(projection.totals).toMatchObject({ charges: 0, credits: 0, net: 0, ordered: { paid: 0 }, kitchen: { prepared: null } });
    expect(closeoutCsv(projection).split("\r\n").filter(Boolean)).toHaveLength(2);
  });

  it("shows a changed plan as the credit and the new charge, both kept, netting to the new price", () => {
    const old = selection({ unitPriceCents: 800, status: "CANCELLED" });
    const next = selection({ unitPriceCents: 1000 });
    const projection = buildCloseout(input({
      selections: [old, next],
      ledger: [entry({ ...old, status: "ACTIVE" }, { settlement: "REGISTRATION_ADJUSTMENT", registrationAdjustmentId: "a1" }), entry({ ...old, status: "ACTIVE" }, { kind: "CREDIT", settlement: "REGISTRATION_ADJUSTMENT", registrationAdjustmentId: "a2" }), entry(next, { settlement: "REGISTRATION_ADJUSTMENT", registrationAdjustmentId: "a3" })]
        .map((row, index) => (index < 2 ? { ...row, selectionId: old.id } : row)),
      adjustments: [{ id: "a1", amountCents: 800 }, { id: "a2", amountCents: -800 }, { id: "a3", amountCents: 1000 }],
    }));
    expect(projection.rows[0]).toMatchObject({ charges: 1800, credits: -800, net: 1000 });
    expect(projection.exceptions.filter((e) => e.category === "FINANCIAL" && e.code !== "RECEIPTS_NOT_ALLOCATED")).toEqual([]);
  });
});

describe("closeout reviews", () => {
  const sel = selection();
  const projection = buildCloseout(input({ selections: [sel], ledger: [] }));
  const exception = projection.exceptions[0]!;
  const review = (over: Partial<CloseoutReview>): CloseoutReview => ({
    id: id("rev"), exceptionKey: exception.key, status: "ACKNOWLEDGED", detailDigest: exception.detailDigest, note: "Checked the till.", reviewedBy: "Fran Finance", reviewedAt: "2026-10-16T12:00:00.000Z", ...over,
  });

  it("starts open, closes on acknowledgement, and keeps the whole history across a reopen", () => {
    expect(applyReviews([exception], [])[0]).toMatchObject({ state: "OPEN", changedSinceReview: false, history: [] });
    const acknowledged = applyReviews([exception], [review({})]);
    expect(acknowledged[0]).toMatchObject({ state: "ACKNOWLEDGED", changedSinceReview: false });
    expect(openExceptionCount(acknowledged)).toBe(0);
    const reopened = applyReviews([exception], [review({}), review({ status: "REOPENED", note: "Recheck." })]);
    expect(reopened[0]).toMatchObject({ state: "OPEN" });
    expect(reopened[0]!.history.map((r) => r.status)).toEqual(["ACKNOWLEDGED", "REOPENED"]);
  });

  it("opens an acknowledged exception again when its figures change", () => {
    const [stale] = applyReviews([exception], [review({ detailDigest: "an-older-digest" })]);
    expect(stale).toMatchObject({ state: "OPEN", changedSinceReview: true });
  });

  it("requires a note and a known status", () => {
    const ok = { exceptionKey: "A:b", status: "ACKNOWLEDGED", note: "Checked", detailDigest: "d" };
    expect(closeoutReviewInputSchema.safeParse(ok).success).toBe(true);
    expect(closeoutReviewInputSchema.safeParse({ ...ok, note: "   " }).success).toBe(false);
    expect(closeoutReviewInputSchema.safeParse({ ...ok, status: "RESOLVED" }).success).toBe(false);
    expect(closeoutReviewInputSchema.safeParse({ ...ok, eventId: "other" }).success).toBe(false);
  });
});

describe("closeout CSV", () => {
  it("matches the screen totals, in dollars, and defuses formulas in notes and labels", () => {
    const sel = selection({ quantity: 2 });
    const projection = buildCloseout(input({ selections: [sel], ledger: [entry(sel)], tickets: tickets(sel) }));
    const lines = closeoutCsv(projection).replace("﻿", "").split("\r\n").filter(Boolean);
    expect(lines).toHaveLength(projection.rows.length + 2);
    const total = lines.at(-1)!.split(",").map((part) => part.replaceAll('"', ""));
    expect(total[0]).toBe("All services");
    expect(total[1]).toBe(String(projection.totals.charges / 100));
    expect(total[3]).toBe(String(projection.totals.net / 100));
    const reviewed = applyReviews(projection.exceptions, [{
      id: "r1", exceptionKey: projection.exceptions[0]!.key, status: "ACKNOWLEDGED", detailDigest: projection.exceptions[0]!.detailDigest,
      note: "=HYPERLINK(\"http://evil.example\")", reviewedBy: "Fran", reviewedAt: "2026-10-16T12:00:00.000Z",
    }]);
    const csv = closeoutExceptionsCsv(reviewed);
    expect(csv).not.toContain('"=HYPERLINK');
    expect(csv).toContain("'=HYPERLINK");
    expect(closeoutCsv({ ...projection, totals: { ...projection.totals, credits: -800 } })).toContain('"-8"');
  });
});
