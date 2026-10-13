import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: vi.fn() }));
vi.mock("@/modules/issued-assets/view", () => ({ describeIssuances: vi.fn() }));
vi.mock("@/modules/issued-assets/returns-view", () => ({ listFacilityIssues: vi.fn() }));

import { closeoutCsv, type CloseoutReport } from "@/modules/issued-assets/closeout";
import {
  applyOutcomeCorrections,
  chargeActionSchema,
  correctionActionSchema,
  coverStateOf,
  effectiveEndReason,
  keepFeesNeedsFee,
  depositHeldCents,
  lateRefundSchema,
  decideDepositOutcome,
  depositActionSchema,
  facilityActionSchema,
  formatCents,
  reconcileUnits,
  resolveReturnQuantity,
  returnRequestSchema,
  stockAfterReturn,
  unitCountsFromHistory,
} from "@/modules/issued-assets/returns-domain";

/**
 * The pure rules of issued-assets slice 2 (#214): what happens to a cash key deposit, how a partial return of a lot is
 * sized, the reconciliation of issued, returned, outstanding, lost and damaged, the request schemas (a loss needs a
 * reason, a waiver needs a reason), and the closeout CSV staying formula-safe. The real-database script proves the writes.
 */

describe("the cash key deposit outcome", () => {
  const two = [{ state: "RETURNED" as const, quantity: 1 }, { state: "RETURNED" as const, quantity: 1 }];

  it("is handed back in full only when both keys come back", () => {
    expect(decideDepositOutcome({ depositCents: 1000, policy: "KEEP_ALL", replacementFeeCents: 2500, covers: two })).toMatchObject({ ok: true, outcome: "FULL_REFUND", refundCents: 1000, keepCents: 0 });
  });

  it("is kept in full under the keep-all policy when one key is lost", () => {
    const outcome = decideDepositOutcome({ depositCents: 1000, policy: "KEEP_ALL", replacementFeeCents: 2500, covers: [two[0]!, { state: "LOST", quantity: 1 }] });
    expect(outcome).toMatchObject({ ok: true, outcome: "KEPT", refundCents: 0, keepCents: 1000, missing: 1 });
  });

  it("keeps only the replacement fee, up to the deposit, under the keep-fees policy", () => {
    const covers = [two[0]!, { state: "LOST" as const, quantity: 1 }];
    expect(decideDepositOutcome({ depositCents: 1000, policy: "KEEP_FEES", replacementFeeCents: 400, covers })).toMatchObject({ outcome: "PARTIAL_REFUND", refundCents: 600, keepCents: 400, shortfallCents: 0 });
    // A fee above the deposit keeps all of it and reports the rest for staff to charge; nothing is charged automatically.
    expect(decideDepositOutcome({ depositCents: 1000, policy: "KEEP_FEES", replacementFeeCents: 2500, covers })).toMatchObject({ outcome: "KEPT", refundCents: 0, keepCents: 1000, shortfallCents: 1500 });
  });

  it("counts a damaged key like a missing one", () => {
    expect(decideDepositOutcome({ depositCents: 1000, policy: "KEEP_ALL", replacementFeeCents: 0, covers: [two[0]!, { state: "DAMAGED", quantity: 1 }] })).toMatchObject({ outcome: "KEPT", damaged: 1 });
  });

  it("has no outcome while a covered key is still out or has no recorded fate", () => {
    expect(decideDepositOutcome({ depositCents: 1000, policy: "KEEP_ALL", replacementFeeCents: 0, covers: [two[0]!, { state: "OUTSTANDING", quantity: 1 }] })).toMatchObject({ ok: false, code: "UNRESOLVED", unresolved: 1 });
    expect(decideDepositOutcome({ depositCents: 1000, policy: "KEEP_ALL", replacementFeeCents: 0, covers: [{ state: "UNACCOUNTED", quantity: 1 }] })).toMatchObject({ ok: false });
  });

  it("does not count an item withdrawn in error or one that continued into a covered successor", () => {
    const outcome = decideDepositOutcome({ depositCents: 1000, policy: "KEEP_ALL", replacementFeeCents: 0, covers: [{ state: "CORRECTED", quantity: 1 }, { state: "CONTINUED", quantity: 1 }, { state: "RETURNED", quantity: 1 }] });
    expect(outcome).toMatchObject({ ok: true, outcome: "FULL_REFUND" });
  });

  it("reads an issuance's state from how it ended", () => {
    expect(coverStateOf({ endedAt: null, endReason: null })).toBe("OUTSTANDING");
    expect(coverStateOf({ endedAt: new Date(), endReason: "RETURNED" })).toBe("RETURNED");
    expect(coverStateOf({ endedAt: new Date(), endReason: "REPLACED" })).toBe("UNACCOUNTED");
    expect(coverStateOf({ endedAt: new Date(), endReason: "TRANSFERRED" })).toBe("CONTINUED");
    expect(coverStateOf({ endedAt: new Date(), endReason: "CORRECTED" })).toBe("CORRECTED");
  });

  it("formats cents as dollars", () => {
    expect(formatCents(1000)).toBe("$10.00");
    expect(formatCents(-250)).toBe("-$2.50");
  });
});

describe("returning a lot in part", () => {
  it("returns a numbered item whole and never in part", () => {
    expect(resolveReturnQuantity(1, true, undefined)).toEqual({ ok: true, quantity: 1, remainder: 0 });
    expect(resolveReturnQuantity(1, true, 2)).toMatchObject({ ok: false });
  });

  it("ends the issue and leaves the remainder out", () => {
    expect(resolveReturnQuantity(5, false, 3)).toEqual({ ok: true, quantity: 3, remainder: 2 });
    expect(resolveReturnQuantity(5, false, undefined)).toEqual({ ok: true, quantity: 5, remainder: 0 });
    expect(resolveReturnQuantity(5, false, 6)).toMatchObject({ ok: false });
  });

  it("holds a lost or damaged numbered item out of stock and a damaged one is recorded as damaged", () => {
    expect(stockAfterReturn("LOST", undefined)).toEqual({ unavailable: true });
    expect(stockAfterReturn("DAMAGED", undefined)).toEqual({ condition: "DAMAGED", unavailable: true });
    expect(stockAfterReturn("RETURNED", "WORN")).toEqual({ condition: "WORN", unavailable: false });
    expect(stockAfterReturn("RETURNED", undefined)).toEqual({ unavailable: false });
  });
});

describe("the reconciliation", () => {
  it("balances issued against returned, lost, damaged, withdrawn, unaccounted originals and what is out", () => {
    const counts = unitCountsFromHistory([
      { type: "ISSUED", quantity: 4 }, { type: "REPLACED_IN", quantity: 1 }, { type: "RETURNED", quantity: 2 }, { type: "LOST", quantity: 1 },
      { type: "DAMAGED", quantity: 1 }, { type: "TRANSFERRED_OUT", quantity: 1 }, { type: "TRANSFERRED_IN", quantity: 1 }, { type: "REMAINDER_ISSUED", quantity: 1 },
    ], 1);
    expect(counts).toMatchObject({ inflow: 5, returned: 2, lost: 1, damaged: 1, outstanding: 1 });
    expect(reconcileUnits(counts)).toEqual({ accounted: 5, difference: 0, balanced: true });
  });

  it("says so when the counts do not add up", () => {
    expect(reconcileUnits({ inflow: 5, returned: 2, lost: 0, damaged: 0, corrected: 0, replacedUnaccounted: 0, outstanding: 1 })).toMatchObject({ balanced: false, difference: 2 });
  });
});

describe("request schemas", () => {
  it("requires a reason for a lost or damaged item and names what is returned", () => {
    expect(returnRequestSchema.safeParse({ items: [{ code: "K-214", outcome: "LOST" }] }).success).toBe(false);
    expect(returnRequestSchema.safeParse({ items: [{ code: "K-214", outcome: "LOST", note: "Not found in the room" }] }).success).toBe(true);
    expect(returnRequestSchema.safeParse({ items: [{ outcome: "RETURNED" }] }).success).toBe(false);
    expect(returnRequestSchema.safeParse({ items: [{ code: "K-214" }], idempotencyKey: "short" }).success).toBe(false);
  });

  it("lets only an offline sheet say when it happened", () => {
    expect(returnRequestSchema.safeParse({ items: [{ code: "K-214" }], occurredAt: "2027-06-18T10:00:00.000Z" }).success).toBe(false);
    expect(returnRequestSchema.safeParse({ items: [{ code: "K-214" }], entryMethod: "OFFLINE", occurredAt: "2027-06-18T10:00:00.000Z" }).success).toBe(true);
  });

  it("limits a deposit to a sensible amount and requires something it covers", () => {
    expect(depositActionSchema.safeParse({ action: "record", issuanceIds: ["i1", "i2"], amountCents: 1000 }).success).toBe(true);
    expect(depositActionSchema.safeParse({ action: "record", issuanceIds: [], amountCents: 1000 }).success).toBe(false);
    expect(depositActionSchema.safeParse({ action: "record", issuanceIds: ["i1"], amountCents: 0 }).success).toBe(false);
    expect(depositActionSchema.safeParse({ action: "record", issuanceIds: ["i1"], amountCents: 5_000_000 }).success).toBe(false);
  });

  it("requires a reason for a waiver and for a charge", () => {
    expect(chargeActionSchema.safeParse({ action: "waive", chargeEntryId: "c1", reason: "" }).success).toBe(false);
    expect(chargeActionSchema.safeParse({ action: "waive", chargeEntryId: "c1", reason: "Guest returned it the next morning" }).success).toBe(true);
    expect(chargeActionSchema.safeParse({ action: "charge", issuanceId: "i1", category: "REPLACEMENT", amountCents: 2500, reason: "" }).success).toBe(false);
  });

  it("reports a facility issue against a room, an item or a place, and only a room can be blocked", () => {
    expect(facilityActionSchema.safeParse({ action: "report", targetKind: "UNIT", title: "Window will not close" }).success).toBe(false);
    expect(facilityActionSchema.safeParse({ action: "report", targetKind: "UNIT", eventUnitId: "u1", title: "Window will not close", block: { kind: "DAMAGE", reason: "Broken window", firstNight: "2027-06-16", lastNight: "2027-06-17" } }).success).toBe(true);
    expect(facilityActionSchema.safeParse({ action: "report", targetKind: "OTHER", targetLabel: "Dining hall", title: "Leak", block: { kind: "SAFETY", reason: "Wet floor", firstNight: "2027-06-16", lastNight: "2027-06-17" } }).success).toBe(false);
    expect(facilityActionSchema.safeParse({ action: "block", issueId: "f1", block: { kind: "SAFETY", reason: "Wet floor", firstNight: "2027-06-18", lastNight: "2027-06-16" } }).success).toBe(false);
  });
});

describe("the closeout CSV", () => {
  const empty: CloseoutReport = {
    generatedAt: "2027-06-19T12:00:00.000Z", truncated: false, types: [], unresolvedCount: 0, outstanding: [], lost: [], damaged: [], charges: [], deposits: [], facility: [], exceptions: [],
    money: { depositsReceivedCents: 0, depositsHandedBackCents: 0, depositsKeptCents: 0, depositsHeldCents: 0, chargedCents: 0, waivedCents: 0, netChargedCents: 0 },
  };

  it("prefixes a value that could run as a formula in a spreadsheet", () => {
    const csv = closeoutCsv({
      ...empty,
      charges: [{ entryId: "e1", issuanceId: "i1", identifier: "K-214", typeName: "Dorm room key", holderLabel: "=HYPERLINK(\"http://example.test\")", deskAttendeeId: null, category: "REPLACEMENT", amountCents: 2500, posted: true, reason: "+1 key lost", actorName: "@staff", at: "2027-06-18T10:00:00.000Z", state: "CHARGED", waiver: null }],
    }, "charges");
    expect(csv).toContain("\"'=HYPERLINK(");
    expect(csv).toContain("\"'+1 key lost\"");
    expect(csv).toContain("\"'@staff\"");
    expect(csv).not.toMatch(/(^|,)"[=+@-]/m);
  });

  it("gives every section a header row", () => {
    for (const section of ["summary", "outstanding", "lost", "damaged", "charges", "deposits", "facility", "exceptions"] as const) {
      expect(closeoutCsv(empty, section).split("\r\n")[0]).toMatch(/\w/);
    }
  });
});

describe("a loss that is already charged", () => {
  const lostCharged = [{ state: "RETURNED" as const, quantity: 1 }, { state: "LOST" as const, quantity: 1, charged: true }];

  it("does not keep the deposit as well, under either policy", () => {
    for (const policy of ["KEEP_ALL", "KEEP_FEES"] as const) {
      const outcome = decideDepositOutcome({ depositCents: 1000, policy, replacementFeeCents: 400, covers: lostCharged });
      expect(outcome, policy).toMatchObject({ ok: true, outcome: "FULL_REFUND", refundCents: 1000, keepCents: 0, missing: 0 });
      expect(outcome.ok && outcome.message).toContain("already charged");
    }
  });

  it("still keeps the deposit for a loss nobody charged", () => {
    const covers = [{ state: "LOST" as const, quantity: 1, charged: true }, { state: "LOST" as const, quantity: 1 }];
    expect(decideDepositOutcome({ depositCents: 1000, policy: "KEEP_ALL", replacementFeeCents: 400, covers })).toMatchObject({ outcome: "KEPT", keepCents: 1000, missing: 1 });
    expect(decideDepositOutcome({ depositCents: 1000, policy: "KEEP_FEES", replacementFeeCents: 400, covers })).toMatchObject({ outcome: "PARTIAL_REFUND", keepCents: 400, refundCents: 600 });
  });
});

describe("corrections and policy rules", () => {
  it("reads the corrected fate, and treats a written-off replaced original as settled", () => {
    expect(effectiveEndReason("LOST", "RETURNED", false)).toBe("RETURNED");
    expect(effectiveEndReason("LOST", null, true)).toBe("LOST");
    expect(effectiveEndReason("REPLACED", null, false)).toBe("REPLACED");
    expect(effectiveEndReason("REPLACED", null, true)).toBe("TRANSFERRED");
    expect(effectiveEndReason("REPLACED", "LOST", true)).toBe("LOST");
  });

  it("moves units between buckets for a correction and keeps the reconciliation balanced", () => {
    const counts = { inflow: 2, returned: 1, lost: 1, damaged: 0, corrected: 0, replacedUnaccounted: 0, outstanding: 0 };
    const next = applyOutcomeCorrections(counts, [{ from: "LOST", to: "RETURNED", quantity: 1 }]);
    expect(next).toMatchObject({ returned: 2, lost: 0 });
    expect(reconcileUnits(next).balanced).toBe(true);
    expect(applyOutcomeCorrections({ ...counts, lost: 0, replacedUnaccounted: 1 }, [{ from: "REPLACED", to: "DAMAGED", quantity: 1 }])).toMatchObject({ replacedUnaccounted: 0, damaged: 1 });
  });

  it("needs a reason for a correction and for a write-off", () => {
    expect(correctionActionSchema.safeParse({ action: "correct", issuanceId: "i1", fate: "RETURNED", reason: "Found under the bed" }).success).toBe(true);
    expect(correctionActionSchema.safeParse({ action: "correct", issuanceId: "i1", fate: "RETURNED", reason: "" }).success).toBe(false);
    expect(correctionActionSchema.safeParse({ action: "correct", issuanceId: "i1", fate: "CORRECTED", reason: "Because" }).success).toBe(false);
    expect(correctionActionSchema.safeParse({ action: "write_off", issuanceId: "i1", reason: "" }).success).toBe(false);
    expect(correctionActionSchema.safeParse({ action: "write_off", issuanceId: "i1", reason: "Guest left the camp" }).success).toBe(true);
  });

  it("asks for a confirmation to charge past a kept deposit, and refuses keep-fees without a fee", () => {
    expect(chargeActionSchema.safeParse({ action: "charge", issuanceId: "i1", category: "REPLACEMENT", amountCents: 2500, reason: "Lost", confirmKeptDeposit: true }).success).toBe(true);
    expect(keepFeesNeedsFee("KEEP_FEES", 0)).toBe(true);
    expect(keepFeesNeedsFee("KEEP_FEES", 400)).toBe(false);
    expect(keepFeesNeedsFee("KEEP_ALL", 0)).toBe(false);
  });
});

describe("reviews and cash handed back after a correction", () => {
  it("needs a reason to mark an exception reviewed", () => {
    expect(correctionActionSchema.safeParse({ action: "review", issuanceId: "i1", exceptionCode: "CORRECTION_NEEDS_REVIEW", reason: "" }).success).toBe(false);
    expect(correctionActionSchema.safeParse({ action: "review", issuanceId: "i1", exceptionCode: "CORRECTION_NEEDS_REVIEW", reason: "Manager agreed" }).success).toBe(true);
  });

  it("lets a waiver review name the waiver it answers", () => {
    expect(correctionActionSchema.safeParse({ action: "review", issuanceId: "i1", exceptionCode: "WAIVED_AFTER_REFUND", triggerId: "w1", reason: "Approved" }).success).toBe(true);
  });

  it("names the exception a review answers", () => {
    expect(correctionActionSchema.safeParse({ action: "review", issuanceId: "i1", reason: "Manager agreed" }).success).toBe(false);
    expect(correctionActionSchema.safeParse({ action: "review", issuanceId: "i1", exceptionCode: "UNCHARGED_LOSS", reason: "Manager agreed" }).success).toBe(false);
  });

  it("defines held as kept less late hand-backs less offsets, never below zero", () => {
    expect(depositHeldCents({ keptCents: 1000, lateCents: 0, offsetCents: 0 })).toBe(1000);
    expect(depositHeldCents({ keptCents: 1000, lateCents: 600, offsetCents: 0 })).toBe(400);
    expect(depositHeldCents({ keptCents: 1000, lateCents: 0, offsetCents: 1000 })).toBe(0);
    expect(depositHeldCents({ keptCents: 1000, lateCents: 600, offsetCents: 600 })).toBe(0);
  });

  it("needs a deposit, an amount and a reason to record cash handed back", () => {
    const base = { action: "refund_after_correction", depositEntryId: "d1", amountCents: 600, reason: "Found; handed back at the desk" };
    expect(lateRefundSchema.safeParse(base).success).toBe(true);
    expect(lateRefundSchema.safeParse({ ...base, amountCents: 0 }).success).toBe(false);
    expect(lateRefundSchema.safeParse({ ...base, reason: "" }).success).toBe(false);
    expect(lateRefundSchema.safeParse({ ...base, amountCents: 5_000_000 }).success).toBe(false);
  });
});
