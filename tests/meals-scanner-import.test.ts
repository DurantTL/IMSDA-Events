import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  eventLocalDate, parseScannerFile, parseScannerInstant, planScannerImport, sha256Hex,
  type ImportTicket, type PlanInput, type ScannerPlan, type ScannerSource,
} from "@/modules/meals/scanner-import";
import { buildServedReport, servedDrillDown, servedReportCsv } from "@/modules/meals/served-report";

const fixture = (name: string) => readFileSync(`tests/fixtures/cafe-scanner/${name}`, "utf8");
const TZ = "America/Chicago";

const ticket = (number: number, code: string, guestName: string, mealType: ImportTicket["mealType"], serviceDate: string, payer: ImportTicket["payer"] = "ATTENDEE"): ImportTicket => ({
  id: `t${number}`, number, confirmationCode: code, guestName, mealType, serviceDate, payer, ageGroup: "ADULT",
});
const tickets: ImportTicket[] = [
  ticket(1, "SYN-AAA1", "Alex Example", "LUNCH", ""),
  ticket(2, "SYN-AAA1", "Alex Example", "LUNCH", ""),
  ticket(3, "SYN-AAA1", "Blake Sample", "SUPPER", "2026-10-15"),
  ticket(4, "SYN-BBB2", "=Casey Formula", "BREAKFAST", "2026-10-15", "CONFERENCE"),
  ticket(5, "SYN-BBB2", "Drew Ambiguous", "LUNCH", ""),
  ticket(6, "SYN-BBB2", "Drew Ambiguous", "LUNCH", "2026-10-15", "CONFERENCE"),
  ticket(7, "SYN-CCC3", "Eli Quiet", "SUPPER", ""),
];

function plan(name: string, overrides: Partial<PlanInput> = {}): ScannerPlan {
  const text = fixture(name);
  return planScannerImport({
    file: parseScannerFile(text), fileSha256: sha256Hex(text), timeZone: TZ, tickets,
    inactiveNumbers: new Set([8]), otherEventNumbers: new Set([77777]),
    served: new Map(), existingKeys: new Set(), existingSources: new Set(),
    ...overrides,
  });
}

/** What the store would hold after confirming a plan. */
function applied(result: ScannerPlan, before: Pick<PlanInput, "served" | "existingKeys" | "existingSources">, source: ScannerSource) {
  const served = new Map(before.served);
  const keys = new Set(before.existingKeys);
  for (const row of result.redemptions) {
    served.set(row.ticketId, { sourceKey: row.sourceKey, occurredAt: new Date(row.occurredAt) });
    keys.add(row.sourceKey);
  }
  return { served, existingKeys: keys, existingSources: new Set<ScannerSource>([...before.existingSources, source]) };
}

describe("reading the scanner's files", () => {
  it("recognizes the Google Sheet download by its ticket_id column", () => {
    const parsed = parseScannerFile(fixture("sheet-with-redemptions.csv"));
    expect(parsed.source).toBe("SHEET");
    expect(parsed.rows).toHaveLength(9);
    // The leading apostrophe that defuses a formula is not part of the name.
    expect(parsed.rows[3]).toMatchObject({ ticketId: "MT-00004", guestName: "=Casey Formula", redeemedBy: "=Casey Formula" });
  });

  it("recognizes transactions.csv and the dotted person.* headers", () => {
    const parsed = parseScannerFile(fixture("transactions.csv"));
    expect(parsed.source).toBe("TRANSACTIONS");
    expect(parsed.rows).toHaveLength(9);
    expect(parsed.rows[2]).toMatchObject({ scannedValue: "SYN-QQQ7", guestName: "Nobody, Known" });
  });

  it("falls back to person.firstName and person.lastName when the entitlement name is blank", () => {
    const parsed = parseScannerFile("timestamp,scannedValue,mealType,result,person.firstName,person.lastName\r\n2026-10-15T17:00:00.000Z,SYN-AAA1,LUNCH,SUCCESS,Alex,Example\r\n");
    expect(parsed.rows[0]).toMatchObject({ guestName: "Alex Example" });
  });

  it("refuses a file that is neither", () => {
    expect(() => parseScannerFile("name,email\r\nA,b@example.test\r\n")).toThrow(/not a café scanner file/);
    expect(() => parseScannerFile("ticket_id,reg_id\r\nMT-00001,X\r\n")).toThrow(/missing these columns/);
  });

  it("reads times as an ISO instant, or as the sheet's zoneless display in the event's zone", () => {
    expect(parseScannerInstant("2026-10-15T17:05:09.000Z", TZ)?.toISOString()).toBe("2026-10-15T17:05:09.000Z");
    expect(parseScannerInstant("10/15/2026 20:15:00", TZ)?.toISOString()).toBe("2026-10-16T01:15:00.000Z");
    expect(parseScannerInstant("2026-10-15 8:15 PM", TZ)).toBeNull();
    expect(parseScannerInstant("not a time", TZ)).toBeNull();
  });

  it("takes the event-local date, not the UTC date", () => {
    expect(eventLocalDate(new Date("2026-10-16T01:30:00.000Z"), TZ)).toBe("2026-10-15");
  });
});

describe("the Google Sheet file (matched by ticket_id)", () => {
  const first = plan("sheet-with-redemptions.csv");

  it("previews matched, unknown, wrong-event and new rows, and saves nothing by itself", () => {
    expect(first.source).toBe("SHEET");
    expect(first.counts).toMatchObject({ newRedemptions: 4, unchanged: 0, conflicts: 0, review: 2, notRedeemed: 3 });
    expect(first.byReason).toEqual({ UNKNOWN_TICKET: 1, WRONG_EVENT: 1 });
    expect(first.redemptions.map((row) => row.ticketNumber)).toEqual([1, 3, 4, 7]);
    expect(first.redemptions.find((row) => row.ticketNumber === 7)?.occurredAt).toBe("2026-10-16T01:15:00.000Z");
    expect(first.redemptions.find((row) => row.ticketNumber === 4)?.redeemedByText).toBe("=Casey Formula");
  });

  it("is idempotent: the same file again adds nothing", () => {
    const state = applied(first, { served: new Map(), existingKeys: new Set(), existingSources: new Set() }, "SHEET");
    const again = plan("sheet-with-redemptions.csv", state);
    expect(again.redemptions).toEqual([]);
    expect(again.counts.newRedemptions).toBe(0);
    expect(again.counts.unchanged).toBe(4);
  });

  it("sends a row that disagrees with its ticket to review instead of saving it", () => {
    const mismatch = plan("sheet-reg-mismatch.csv");
    expect(mismatch.redemptions).toEqual([]);
    expect(mismatch.byReason).toEqual({ MISMATCH: 2, INVALID_ROW: 1 });
  });

  it("shows an un-redeem in a later file as a conflict that is never applied by itself", () => {
    const state = applied(first, { served: new Map(), existingKeys: new Set(), existingSources: new Set() }, "SHEET");
    const later = plan("sheet-later-unredeem.csv", state);
    expect(later.redemptions).toEqual([]);
    expect(later.counts.conflicts).toBe(1);
    expect(later.conflicts[0]).toMatchObject({ ticketNumber: 1 });
    expect(later.conflicts[0]!.sourceKey).toMatch(/^unredeem:sheet:MT-00001:/);
    expect(later.counts.unchanged).toBe(1);
  });

  it("does not re-redeem a ticket after an accepted correction when the old file is uploaded again", () => {
    const state = applied(first, { served: new Map(), existingKeys: new Set(), existingSources: new Set() }, "SHEET");
    const served = new Map(state.served);
    served.delete("t1");
    const again = plan("sheet-with-redemptions.csv", { ...state, served });
    expect(again.redemptions.map((row) => row.ticketNumber)).not.toContain(1);
  });

  it("changes the digest when the records change under a preview", () => {
    const state = applied(first, { served: new Map(), existingKeys: new Set(), existingSources: new Set() }, "SHEET");
    expect(plan("sheet-with-redemptions.csv", state).digest).not.toBe(first.digest);
    expect(plan("sheet-with-redemptions.csv").digest).toBe(first.digest);
  });

  it("flags a cancelled ticket", () => {
    const cancelled = planScannerImport({
      file: parseScannerFile(fixture("sheet-with-redemptions.csv")), fileSha256: "0".repeat(64), timeZone: TZ, tickets: tickets.filter((row) => row.number !== 7),
      inactiveNumbers: new Set([7]), otherEventNumbers: new Set(), served: new Map(), existingKeys: new Set(), existingSources: new Set(),
    });
    expect(cancelled.byReason.INACTIVE_TICKET).toBe(1);
  });
});

describe("transactions.csv (matched by registration, guest, meal and local date)", () => {
  const empty = { served: new Map(), existingKeys: new Set<string>(), existingSources: new Set<ScannerSource>() };
  const result = plan("transactions.csv");

  it("counts only SUCCESS rows, maps DINNER to supper and uses the event-local date", () => {
    expect(result.source).toBe("TRANSACTIONS");
    expect(result.counts.notSuccess).toBe(1);
    // Alex x2 (two interchangeable tickets), Blake (UTC date is the 16th, local the 15th), Casey (formula guard).
    expect(result.redemptions.map((row) => row.ticketNumber).sort()).toEqual([1, 2, 3, 4]);
  });

  it("gives each scan its own ticket and reports a third scan as more than the tickets", () => {
    expect(result.byReason).toMatchObject({ ALL_USED: 1, AMBIGUOUS: 1, NO_MATCH: 1, INVALID_ROW: 1 });
    expect(result.counts.review).toBe(4);
  });

  it("is idempotent: importing the file again adds nothing", () => {
    const again = plan("transactions.csv", applied(result, empty, "TRANSACTIONS"));
    expect(again.redemptions).toEqual([]);
    expect(again.counts.unchanged).toBe(4);
  });

  it("warns when the event already holds results from the other file kind", () => {
    expect(result.otherSourceHasRedemptions).toBe(false);
    expect(plan("transactions.csv", { ...empty, existingSources: new Set<ScannerSource>(["SHEET"]) }).otherSourceHasRedemptions).toBe(true);
    expect(plan("sheet-with-redemptions.csv", { ...empty, existingSources: new Set<ScannerSource>(["TRANSACTIONS"]) }).otherSourceHasRedemptions).toBe(true);
  });

  it("does not depend on the order the scanner exported the rows in", () => {
    const text = fixture("transactions.csv");
    const [header, ...rows] = text.trimEnd().split("\r\n");
    const reversed = [header, ...rows.reverse()].join("\r\n") + "\r\n";
    const other = planScannerImport({
      file: parseScannerFile(reversed), fileSha256: sha256Hex(reversed), timeZone: TZ, tickets, inactiveNumbers: new Set(), otherEventNumbers: new Set(), ...empty,
    });
    expect(other.redemptions.map((row) => [row.ticketId, row.sourceKey]).sort()).toEqual(result.redemptions.map((row) => [row.ticketId, row.sourceKey]).sort());
  });
});

describe("meals served against tickets sold", () => {
  const sold = tickets.map((row) => ({ id: row.id, number: row.number, mealType: row.mealType, serviceDate: row.serviceDate, payer: row.payer }));
  const served = new Map([["t1", new Date("2026-10-15T17:05:09Z")], ["t3", new Date("2026-10-16T01:30:00Z")], ["t4", new Date("2026-10-15T13:00:00Z")]]);
  const report = buildServedReport(sold, served);

  it("counts sold, served and not used by service, split by payer", () => {
    const row = (key: string) => report.rows.find((entry) => entry.key === key)!;
    expect(row("any:LUNCH")).toMatchObject({ sold: { paying: 3, conference: 0, total: 3 }, served: { paying: 1, conference: 0, total: 1 }, notUsed: { paying: 2, conference: 0, total: 2 } });
    expect(row("2026-10-15:BREAKFAST")).toMatchObject({ sold: { conference: 1 }, served: { conference: 1 }, notUsed: { total: 0 } });
    expect(row("2026-10-15:LUNCH").sold).toMatchObject({ conference: 1, paying: 0 });
    expect(report.totals).toMatchObject({ sold: { total: 7, paying: 5, conference: 2 }, served: { total: 3 }, notUsed: { total: 4 } });
    expect(report.rows.map((entry) => entry.key)[0]).toBe("2026-10-15:BREAKFAST");
  });

  it("drills down to ticket ids without names", () => {
    const rows = servedDrillDown(sold, served, "any:LUNCH", TZ);
    expect(rows).toEqual([
      { ticketId: "MT-00001", payer: "ATTENDEE", served: true, servedOn: "2026-10-15" },
      { ticketId: "MT-00002", payer: "ATTENDEE", served: false, servedOn: "" },
      { ticketId: "MT-00005", payer: "ATTENDEE", served: false, servedOn: "" },
    ]);
    expect(JSON.stringify(rows)).not.toMatch(/Alex|Casey|Drew|SYN-/);
  });

  it("writes a counts-only CSV with no names", () => {
    const csv = servedReportCsv(report);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("Any day · Lunch");
    expect(csv).not.toMatch(/Alex|Casey|Drew|Eli|Blake|SYN-/);
  });
});
