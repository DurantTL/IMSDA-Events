import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));

import { AssetCloseoutWorkspace } from "@/components/asset-closeout-workspace";
import { AssetReturnPanel } from "@/components/asset-return-panel";
import type { CloseoutReport, CloseoutRow } from "@/modules/issued-assets/closeout";
import type { DeskMoney } from "@/modules/issued-assets/returns-view";
import type { DeskPerson, DeskType, IssuanceRow } from "@/modules/issued-assets/view";

/**
 * The check-out panel and the closeout (#214), rendered on the server with synthetic data: the desk says in words what
 * happens to the deposit, offers the standard replacement fee but not a free amount to check-in staff, and only finance
 * and administrators see a waiver. Each button's effect is checked by the real-database script and the route tests.
 */
const types: DeskType[] = [{ id: "t1", name: "Dorm room key", mode: "SERIALIZED", assigneeKinds: ["ATTENDEE"], roomLinked: true, depositPolicyRef: null, depositCents: 1000, depositShortfall: "KEEP_ALL", replacementFeeCents: 2500 }];
const row = (extra: Partial<IssuanceRow>): IssuanceRow => ({
  id: "i1", assetId: "a1", identifier: "K-214", typeName: "Dorm room key", serialized: true, quantity: 1, holderKind: "ATTENDEE", attendeeId: "att1", registrationId: null, holderLabel: "Pat Example",
  purpose: "Issued at check-in", issuedAt: "2027-06-15T18:00:00.000Z", issuedByName: "Synthetic Staff", entryMethod: "MANUAL", expectedReturnAt: null, open: true, endReason: null, endedAt: null,
  endNote: null, endQuantity: null, depositEntryId: null, previousIssuanceId: null, roomName: "214, Girls Dorm", sourceAssignmentId: "as1", lodging: null, ...extra,
});
const person = (issuances: IssuanceRow[]): DeskPerson => ({
  attendeeId: "att1", registrationId: "reg1", name: "Pat Example", confirmationCode: "CODE-1", registrationActive: true,
  rooms: [{ assignmentId: "as1", unitId: "u1", roomName: "214, Girls Dorm", firstNight: "2027-06-15", lastNight: "2027-06-18" }], issuances,
});
const noMoney: DeskMoney = { deposits: [], charges: [], fates: {} };

const panel = (p: DeskPerson, money: DeskMoney, flags: { canConfigure?: boolean; canManageMoney?: boolean } = {}) => renderToStaticMarkup(createElement(AssetReturnPanel, {
  eventId: "ev1", userId: "usr_1", person: p, money, types, canConfigure: flags.canConfigure ?? false, canManageMoney: flags.canManageMoney ?? false,
}));

describe("check-out panel", () => {
  it("lists each open key with what can happen to it, and a new key to hand over", () => {
    const html = panel(person([row({}), row({ id: "i2", identifier: "K-215", assetId: "a2" })]), noMoney);
    expect(html).toContain("Check out: Pat Example");
    expect(html).toContain("What happened to K-214");
    expect(html).toContain("What happened to K-215");
    expect(html).toContain("Returned damaged");
    expect(html).toContain("Not back yet");
    expect(html).toContain("Mark everything returned");
    expect(html).toContain("Record check-out");
    expect(html).toContain("This desk records; it does not move money.");
  });

  it("offers a cash deposit for keys no deposit covers yet, at the usual amount", () => {
    const html = panel(person([row({}), row({ id: "i2", identifier: "K-215", assetId: "a2" })]), noMoney);
    expect(html).toContain("K-214, K-215 (Dorm room key) has no deposit yet. Usual deposit $10.00.");
    expect(html).toContain("Cash taken (dollars)");
  });

  it("says what settling would do, in words, and records that cash was handed back", () => {
    const money: DeskMoney = {
      charges: [], fates: {},
      deposits: [{
        entryId: "d1", amountCents: 1000, typeName: "Dorm room key", takenAt: "2027-06-15T18:05:00.000Z", takenByName: "Synthetic Staff",
        covers: [{ issuanceId: "i1", identifier: "K-214", state: "RETURNED", quantity: 1, charged: false }, { issuanceId: "i2", identifier: "K-215", state: "RETURNED", quantity: 1, charged: false }],
        keptRemainingCents: 0, settled: null, outcome: { ok: true, outcome: "FULL_REFUND", refundCents: 1000, keepCents: 0, shortfallCents: 0, missing: 0, damaged: 0, message: "Every covered item came back in good order: hand back the full deposit." },
      }],
    };
    const html = panel(person([row({ open: false, endReason: "RETURNED", endedAt: "2027-06-18T10:00:00.000Z", endQuantity: 1, depositEntryId: "d1" })]), money);
    expect(html).toContain("$10.00 cash deposit");
    expect(html).toContain("K-214 (returned), K-215 (returned)");
    expect(html).toContain("hand back the full deposit");
    expect(html).toContain("I handed back $10.00");
  });

  it("says why a deposit cannot be settled while a key is still out", () => {
    const money: DeskMoney = {
      charges: [], fates: {},
      deposits: [{
        entryId: "d1", amountCents: 1000, typeName: "Dorm room key", takenAt: "2027-06-15T18:05:00.000Z", takenByName: "Synthetic Staff",
        covers: [{ issuanceId: "i1", identifier: "K-214", state: "RETURNED", quantity: 1, charged: false }, { issuanceId: "i2", identifier: "K-215", state: "OUTSTANDING", quantity: 1, charged: false }],
        keptRemainingCents: 0, settled: null, outcome: { ok: false, code: "UNRESOLVED", unresolved: 1, message: "1 covered item is still out or without a recorded return, loss or damage." },
      }],
    };
    const html = panel(person([row({ id: "i2", identifier: "K-215", depositEntryId: "d1" })]), money);
    expect(html).toContain("K-215 (still out)");
    expect(html).toContain("1 covered item is still out");
    expect(html).not.toContain("I handed back");
  });

  it("offers the standard replacement fee for a lost key, and a free amount only to finance or administrators", () => {
    const lost = row({ id: "i3", open: false, endReason: "LOST", endedAt: "2027-06-18T10:00:00.000Z", endQuantity: 1 });
    const checkIn = panel(person([lost]), noMoney);
    expect(checkIn).toContain("The standard replacement fee is $25.00.");
    expect(checkIn).toContain("Charge $25.00 to the registration");
    expect(checkIn).not.toContain("Another amount");
    expect(panel(person([lost]), noMoney, { canManageMoney: true })).toContain("Another amount");
  });

  it("does not offer the standard fee when the deposit already kept money for the loss", () => {
    const lostRow = row({ id: "i3", open: false, endReason: "LOST", endedAt: "2027-06-18T10:00:00.000Z", endQuantity: 1, depositEntryId: "d1" });
    const money: DeskMoney = {
      charges: [], fates: {},
      deposits: [{
        entryId: "d1", amountCents: 1000, typeName: "Dorm room key", takenAt: "2027-06-15T18:05:00.000Z", takenByName: "Synthetic Staff", keptRemainingCents: 1000,
        covers: [{ issuanceId: "i3", identifier: "K-214", state: "LOST", quantity: 1, charged: false }],
        settled: { refundCents: 0, keepCents: 1000, at: "2027-06-18T11:00:00.000Z", byName: "Synthetic Staff", lateHandedBackCents: 0 }, outcome: null,
      }],
    };
    const checkIn = panel(person([lostRow]), money);
    expect(checkIn).toContain("The cash deposit already kept $10.00");
    expect(checkIn).toContain("would take the guest");
    expect(checkIn).not.toContain("Charge $25.00 to the registration");
    expect(checkIn).toContain("Finance or an event administrator can charge the part above what the deposit kept.");
    const finance = panel(person([lostRow]), money, { canManageMoney: true });
    expect(finance).toContain("Charge only the part above the kept deposit");
    expect(finance).not.toContain("Charge $25.00 to the registration");
  });

  it("stops offering a charge for a loss that was written off or found", () => {
    const lostRow = row({ id: "i3", open: false, endReason: "LOST", endedAt: "2027-06-18T10:00:00.000Z", endQuantity: 1 });
    expect(panel(person([lostRow]), { ...noMoney, fates: { i3: { endReason: "LOST", corrected: false, writtenOff: true } } })).not.toContain("The standard replacement fee");
    expect(panel(person([lostRow]), { ...noMoney, fates: { i3: { endReason: "RETURNED", corrected: true, writtenOff: false } } })).not.toContain("The standard replacement fee");
  });

  it("shows a recorded charge and where a waiver is done", () => {
    const money: DeskMoney = { deposits: [], charges: [{ entryId: "c1", issuanceId: "i3", identifier: "K-214", category: "REPLACEMENT", amountCents: 2500, posted: true, reason: "Replacement fee for K-214", at: "2027-06-18T10:00:00.000Z", waived: false, depositOffsetCents: 0 }], fates: {} };
    const html = panel(person([row({ id: "i3", open: false, endReason: "LOST", endedAt: "2027-06-18T10:00:00.000Z", endQuantity: 1 })]), money);
    expect(html).toContain("Replacement charge $25.00 (posted to the registration)");
    expect(html).toContain("Waiving a charge needs finance or an event administrator");
    expect(html).toContain("/more/issued-assets/closeout?event=ev1");
  });

  it("lets only an administrator block the room it reports", () => {
    expect(panel(person([row({})]), noMoney)).toContain("An event administrator can block the room once the issue is reported.");
    expect(panel(person([row({})]), noMoney, { canConfigure: true })).toContain("Also block the room for later nights (nobody who is already placed is moved)");
  });
});

const closeoutRow = (extra: Partial<CloseoutRow>): CloseoutRow => ({ ...row({}), deskAttendeeId: "att1", overdue: false, ...extra });
const report: CloseoutReport = {
  generatedAt: "2027-06-19T12:00:00.000Z", truncated: false, unresolvedCount: 3,
  types: [{ typeId: "t1", typeName: "Dorm room key", inflow: 4, returned: 2, lost: 1, damaged: 0, corrected: 0, replacedUnaccounted: 0, outstanding: 1, difference: 0, balanced: true }],
  money: { depositsReceivedCents: 2000, depositsHandedBackCents: 1000, depositsKeptCents: 0, depositsHeldCents: 1000, chargedCents: 2500, waivedCents: 0, netChargedCents: 2500 },
  outstanding: [closeoutRow({ id: "o1", identifier: "K-216", expectedReturnAt: "2027-06-18T10:00:00.000Z", overdue: true })],
  lost: [closeoutRow({ id: "l1", identifier: "K-214", open: false, endReason: "LOST", endedAt: "2027-06-18T10:00:00.000Z", endNote: "Not found in the room" })],
  damaged: [],
  charges: [{ entryId: "c1", issuanceId: "l1", identifier: "K-214", typeName: "Dorm room key", holderLabel: "Pat Example", deskAttendeeId: "att1", category: "REPLACEMENT", amountCents: 2500, posted: true, reason: "Replacement fee", actorName: "Synthetic Staff", at: "2027-06-18T10:05:00.000Z", state: "CHARGED", waiver: null }],
  deposits: [{ entryId: "d1", typeName: "Dorm room key", holderLabel: "Pat Example", deskAttendeeId: "att1", amountCents: 1000, takenAt: "2027-06-15T18:05:00.000Z", takenByName: "Synthetic Staff", state: "HELD", refundCents: 0, keepCents: 0, lateHandedBackCents: 0, stillHeldCents: 0, covered: 2, stillOut: 1, readyToSettle: false }],
  facility: [{
    id: "f1", title: "Window will not close", description: null, severity: "HIGH", status: "OPEN", source: "CHECKOUT_INSPECTION", targetKind: "UNIT", targetLabel: "214, Girls Dorm", eventUnitId: "u1", assigneeUserId: null, assigneeName: null,
    reportedAt: "2027-06-18T10:10:00.000Z", reportedByName: "Synthetic Staff", resolution: null, resolvedAt: null, block: null, history: [],
  }],
  exceptions: [
    { code: "OUTSTANDING_ITEM", label: "Still out", subject: "K-216 (Dorm room key)", detail: "out since 2027-06-15, past its expected return", holderLabel: "Pat Example", amountCents: null, deskAttendeeId: "att1", refId: "o1" },
    { code: "DEPOSIT_UNSETTLED", label: "Cash deposit not settled", subject: "$10.00 Dorm room key deposit", detail: "1 covered item is still out.", holderLabel: "Pat Example", amountCents: 1000, deskAttendeeId: "att1", refId: "d1" },
    { code: "FACILITY_OPEN", label: "Facility issue unresolved", subject: "214, Girls Dorm: Window will not close", detail: "high severity, open, not assigned.", holderLabel: null, amountCents: null, deskAttendeeId: null, refId: "f1" },
  ],
};
const closeout = (flags: { canManageMoney: boolean; canConfigure: boolean }) => renderToStaticMarkup(createElement(AssetCloseoutWorkspace, {
  eventId: "ev1", eventName: "Camp Meeting 2027", report, staff: [{ userId: "usr_1", name: "Synthetic Staff" }], canManageMoney: flags.canManageMoney, canConfigure: flags.canConfigure, canUpdateFacility: true,
}));

describe("closeout screen", () => {
  it("states what is unresolved, with the reasons and a way to each holder's desk", () => {
    const html = closeout({ canManageMoney: false, canConfigure: false });
    expect(html).toContain("3 unresolved");
    expect(html).toContain("Cash deposit not settled");
    expect(html).toContain("1 covered item is still out.");
    expect(html).toContain("/check-in/assets?event=ev1&amp;attendee=att1");
    expect(html).toContain("past due");
    expect(html).toContain("does not charge, waive, refund or release anything by itself");
  });

  it("reconciles issued against returned, lost and still out, in words", () => {
    const html = closeout({ canManageMoney: false, canConfigure: false });
    expect(html).toContain("Issued, returned and outstanding");
    expect(html).toContain("Cash deposits: $20.00 received, $10.00 handed back, $0.00 kept, $10.00 still held.");
    expect(html).toContain("Charges: $25.00, waived $0.00, net $25.00.");
  });

  it("offers a CSV for every list", () => {
    const html = closeout({ canManageMoney: false, canConfigure: false });
    for (const section of ["summary", "outstanding", "lost", "damaged", "charges", "deposits", "facility", "exceptions"]) {
      expect(html).toContain(`/api/events/ev1/assets/closeout?format=csv&amp;section=${section}`);
    }
  });

  it("shows a waiver only to finance or administrators, and a room block only to administrators", () => {
    const checkIn = closeout({ canManageMoney: false, canConfigure: false });
    expect(checkIn).not.toContain("Reason to waive");
    expect(checkIn).toContain("Waiving a charge needs finance or an event administrator.");
    expect(checkIn).not.toContain("Block the room");
    const finance = closeout({ canManageMoney: true, canConfigure: false });
    expect(finance).toContain("Reason to waive");
    expect(finance).not.toContain("Block the room");
    expect(closeout({ canManageMoney: true, canConfigure: true })).toContain("Block the room");
  });
});

describe("closeout corrections", () => {
  const withException: CloseoutReport = {
    ...report,
    exceptions: [{ code: "UNCHARGED_LOSS", label: "Lost or damaged, nothing charged, waived or kept", subject: "K-214 (Dorm room key)", detail: "Lost.", holderLabel: "Pat Example", amountCents: null, deskAttendeeId: "att1", refId: "l1" }],
  };
  const render = (canManageMoney: boolean) => renderToStaticMarkup(createElement(AssetCloseoutWorkspace, {
    eventId: "ev1", eventName: "Camp Meeting 2027", report: withException, staff: [], canManageMoney, canConfigure: false, canUpdateFacility: true,
  }));

  it("offers a found key, a loss and a write-off to finance and administrators only", () => {
    const finance = render(true);
    expect(finance).toContain("Found: it came back");
    expect(finance).toContain("Write off, charge nothing");
    expect(finance).toContain("Resolve");
    const checkIn = render(false);
    expect(checkIn).not.toContain("Write off, charge nothing");
    expect(checkIn).not.toContain("Found: it came back");
  });
});

describe("closeout reviews", () => {
  const review: CloseoutReport = {
    ...report,
    exceptions: [
      { code: "CORRECTION_NEEDS_REVIEW", label: "Outcome corrected after money was recorded", subject: "K-214 (Dorm room key)", detail: "Corrected to returned.", holderLabel: "Pat Example", amountCents: null, deskAttendeeId: "att1", refId: "l1", depositId: "d1" },
      { code: "WAIVED_ON_INACTIVE_REGISTRATION", label: "Waived after cancellation: the line is still on the registration total", subject: "K-215 (Dorm room key)", detail: "Still on the total.", holderLabel: "Pat Example", amountCents: 2500, deskAttendeeId: "att1", refId: "l2" },
    ],
  };
  const render = (canManageMoney: boolean) => renderToStaticMarkup(createElement(AssetCloseoutWorkspace, {
    eventId: "ev1", eventName: "Camp Meeting 2027", report: review, staff: [], canManageMoney, canConfigure: false, canUpdateFacility: true,
  }));

  it("lists a key charge on a cancelled registration with a review form for finance only", () => {
    const cancelled: CloseoutReport = { ...report, exceptions: [{ code: "CHARGED_ON_CANCELLED_REGISTRATION", label: "Charged for a key or item, but the registration was cancelled before paying", subject: "L-11 (Lodge key)", detail: "Decide.", holderLabel: "Pat Example", amountCents: 400, deskAttendeeId: "att1", refId: "i1", triggerId: "c1" }] };
    const html = (canManageMoney: boolean) => renderToStaticMarkup(createElement(AssetCloseoutWorkspace, { eventId: "ev1", eventName: "Camp Meeting 2027", report: cancelled, staff: [], canManageMoney, canConfigure: false, canUpdateFacility: true }));
    expect(html(true)).toContain("registration was cancelled before paying");
    expect(html(true)).toContain("Reviewed, nothing more to do");
    expect(html(false)).not.toContain("Reviewed, nothing more to do");
  });

  it("shows a deposit partly handed back, and what is still held", () => {
    const partly: CloseoutReport = { ...report, deposits: [{ ...report.deposits[0]!, state: "PARTLY_HANDED_BACK", refundCents: 600, keepCents: 400, lateHandedBackCents: 600, stillHeldCents: 400 }] };
    const html = renderToStaticMarkup(createElement(AssetCloseoutWorkspace, { eventId: "ev1", eventName: "Camp Meeting 2027", report: partly, staff: [], canManageMoney: true, canConfigure: false, canUpdateFacility: true }));
    expect(html).toContain("Partly handed back");
    expect(html).toContain("$4.00 of that still held");
  });

  it("lets finance mark a review done or record cash handed back from the kept deposit, and nobody else", () => {
    const finance = render(true);
    expect(finance).toContain("Reviewed, nothing more to do");
    expect(finance).toContain("Cash handed back from the kept deposit");
    expect(finance).toContain("Waived after cancellation: the line is still on the registration total");
    expect(render(false)).not.toContain("Reviewed, nothing more to do");
  });
});
