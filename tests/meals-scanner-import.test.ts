import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  eventLocalDate, eventLocalDateTime, parseScannerFile, parseScannerInstant, planScannerImport, sha256Hex,
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
    served: new Map(), unredeemed: new Map(), existingKeys: new Set(), existingSources: new Set(),
    ...overrides,
  });
}

type State = Pick<PlanInput, "served" | "unredeemed" | "existingKeys" | "existingSources">;
const emptyState = (): State => ({ served: new Map(), unredeemed: new Map(), existingKeys: new Set(), existingSources: new Set() });

/** What the store would hold after confirming a plan (its new redemptions, and any conflicts staff accepted). */
function applied(result: ScannerPlan, before: State, source: ScannerSource, acceptedConflicts: readonly number[] = []): State {
  const served = new Map(before.served);
  const unredeemed = new Map(before.unredeemed);
  const keys = new Set(before.existingKeys);
  for (const row of result.redemptions) {
    served.set(row.ticketId, { sourceKey: row.sourceKey, occurredAt: new Date(row.occurredAt) });
    unredeemed.delete(row.ticketId);
    keys.add(row.sourceKey);
  }
  for (const row of result.conflicts.filter((entry) => acceptedConflicts.includes(entry.ticketNumber))) {
    keys.add(row.sourceKey);
    if (row.kind === "UNREDEEM") {
      served.delete(row.ticketId);
      unredeemed.set(row.ticketId, row.sourceKey);
    } else {
      served.set(row.ticketId, { sourceKey: row.sourceKey, occurredAt: new Date(row.servedAt) });
      unredeemed.delete(row.ticketId);
    }
  }
  return { served, unredeemed, existingKeys: keys, existingSources: new Set<ScannerSource>([...before.existingSources, source]) };
}

describe("reading the scanner's files", () => {
  it("recognizes the Google Sheet download by its ticket_id column", () => {
    const parsed = parseScannerFile(fixture("sheet-with-redemptions.csv"));
    expect(parsed.source).toBe("SHEET");
    expect(parsed.rows).toHaveLength(9);
    // The leading apostrophe that defuses a formula is not part of the name.
    expect(parsed.rows[3]).toMatchObject({ ticketId: "MT-00004", guestName: "=Casey Formula", redeemedBy: "=Casey Formula" });
  });

  it("recognizes transactions.csv and its dotted person.* headers", () => {
    const parsed = parseScannerFile(fixture("transactions.csv"));
    expect(parsed.source).toBe("TRANSACTIONS");
    expect(parsed.rows).toHaveLength(10);
    expect(parsed.rows[3]).toMatchObject({ scannedValue: "SYN-QQQ7", guestName: "Nobody, Known", stationName: "Station 1" });
  });

  it("reads a file with or without a trailing newline the same way", () => {
    for (const name of ["sheet-with-redemptions.csv", "transactions.csv"]) {
      const text = fixture(name);
      expect(text.endsWith("\r\n")).toBe(true);
      expect(parseScannerFile(text.replace(/\r\n$/, "")).rows).toEqual(parseScannerFile(text).rows);
      expect(parseScannerFile(text.replace(/\r\n/g, "\n")).rows).toEqual(parseScannerFile(text).rows);
    }
  });

  it("reads a file saved with a byte-order mark", () => {
    expect(parseScannerFile("﻿" + fixture("sheet-later-unredeem.csv")).rows).toHaveLength(2);
  });

  it("does not take the guest from the person columns when entitlementPersonName is blank", () => {
    const text = "timestamp,scannedValue,mealType,result,entitlementPersonName,person.firstName,person.lastName\r\n2026-10-15T17:00:00.000Z,SYN-AAA1,LUNCH,SUCCESS,,Alex,Example\r\n";
    const parsed = parseScannerFile(text);
    expect(parsed.rows[0]).toMatchObject({ guestName: "" });
    const result = planScannerImport({ file: parsed, fileSha256: sha256Hex(text), timeZone: TZ, tickets, inactiveNumbers: new Set(), otherEventNumbers: new Set(), ...emptyState() });
    expect(result.redemptions).toEqual([]);
    expect(result.byReason).toEqual({ INVALID_ROW: 1 });
  });

  it("refuses a file that is neither", () => {
    expect(() => parseScannerFile("name,email\r\nA,b@example.test\r\n")).toThrow(/not a café scanner file/);
    expect(() => parseScannerFile("ticket_id,reg_id\r\nMT-00001,X\r\n")).toThrow(/missing these columns/);
  });

  it("reads only an ISO instant with a zone", () => {
    expect(parseScannerInstant("2026-10-15T17:05:09.000Z")?.toISOString()).toBe("2026-10-15T17:05:09.000Z");
    expect(parseScannerInstant("2026-10-15T12:05:09-05:00")?.toISOString()).toBe("2026-10-15T17:05:09.000Z");
    expect(parseScannerInstant("10/15/2026 20:15:00")).toBeNull();
    expect(parseScannerInstant("2026-10-15 20:15:00")).toBeNull();
    expect(parseScannerInstant("2026-10-15T20:15:00")).toBeNull();
    expect(parseScannerInstant("not a time")).toBeNull();
  });

  it("takes the event-local date, not the UTC date", () => {
    expect(eventLocalDate(new Date("2026-10-16T01:30:00.000Z"), TZ)).toBe("2026-10-15");
    expect(eventLocalDateTime(new Date("2026-10-16T01:30:00.000Z"), TZ)).toBe("Oct 15, 2026, 8:30 PM CDT");
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
    const again = plan("sheet-with-redemptions.csv", applied(first, emptyState(), "SHEET"));
    expect(again.redemptions).toEqual([]);
    expect(again.counts.newRedemptions).toBe(0);
    expect(again.counts.unchanged).toBe(4);
  });

  it("keys a redemption on whole UTC seconds, so a copy that lost its milliseconds matches", () => {
    const keyOf = (stamp: string) => {
      const text = `ticket_id,reg_id,guest_name,meal_type,redeemed,redeemed_at,redeemed_by\r\nMT-00001,SYN-AAA1,Alex Example,lunch,yes,${stamp},Alex Example\r\n`;
      return planScannerImport({ file: parseScannerFile(text), fileSha256: sha256Hex(text), timeZone: TZ, tickets, inactiveNumbers: new Set(), otherEventNumbers: new Set(), ...emptyState() }).redemptions[0]!.sourceKey;
    };
    expect(keyOf("2026-10-15T17:05:09Z")).toBe("sheet:MT-00001:2026-10-15T17:05:09Z");
    expect(keyOf("2026-10-15T17:05:09.000Z")).toBe(keyOf("2026-10-15T17:05:09Z"));
    expect(keyOf("2026-10-15T17:05:09.870Z")).toBe(keyOf("2026-10-15T17:05:09Z"));
  });

  it("sends a row that disagrees with its ticket, or has a time without a zone, to review", () => {
    const mismatch = plan("sheet-reg-mismatch.csv");
    expect(mismatch.redemptions).toEqual([]);
    expect(mismatch.byReason).toEqual({ MISMATCH: 2, INVALID_ROW: 2 });
    expect(mismatch.review.find((row) => row.summary.includes("MT-00007"))?.summary).toMatch(/ISO time with a zone/);
  });

  it("sends a shifted row (redeemed_by is not its guest) to review and still records the honest one", () => {
    const shifted = plan("sheet-shifted-row.csv");
    expect(shifted.byReason).toEqual({ MISMATCH: 1 });
    expect(shifted.review[0]).toMatchObject({ line: 2, reason: "MISMATCH" });
    expect(shifted.redemptions.map((row) => row.ticketNumber)).toEqual([1]);
  });

  it("shows an un-redeem in a later file as a conflict that is never applied by itself", () => {
    const state = applied(first, emptyState(), "SHEET");
    const later = plan("sheet-later-unredeem.csv", state);
    expect(later.redemptions).toEqual([]);
    expect(later.counts.conflicts).toBe(1);
    expect(later.conflicts[0]).toMatchObject({ kind: "UNREDEEM", ticketNumber: 1 });
    expect(later.conflicts[0]!.sourceKey).toBe("unredeem:sheet:MT-00001:2026-10-15T17:05:09Z");
    expect(later.counts.unchanged).toBe(1);
  });

  it("offers to put a ticket back after an accepted un-redeem, and only once", () => {
    const firstState = applied(first, emptyState(), "SHEET");
    const afterUnredeem = applied(plan("sheet-later-unredeem.csv", firstState), firstState, "SHEET", [1]);
    expect(afterUnredeem.served.has("t1")).toBe(false);

    const again = plan("sheet-with-redemptions.csv", afterUnredeem);
    expect(again.redemptions).toEqual([]);
    expect(again.conflicts).toEqual([
      expect.objectContaining({ kind: "REREDEEM", ticketNumber: 1, servedAt: "2026-10-15T17:05:09.000Z", sourceKey: "reredeem:unredeem:sheet:MT-00001:2026-10-15T17:05:09Z", redeemedByText: "Alex Example" }),
    ]);

    const afterPutBack = applied(again, afterUnredeem, "SHEET", [1]);
    expect(afterPutBack.served.has("t1")).toBe(true);
    const third = plan("sheet-with-redemptions.csv", afterPutBack);
    expect(third.conflicts).toEqual([]);
    expect(third.redemptions).toEqual([]);

    // Un-redeemed again later: the next put-back has its own key, so it is not blocked by the first.
    const secondUnredeem = applied(plan("sheet-later-unredeem.csv", afterPutBack), afterPutBack, "SHEET", [1]);
    const next = plan("sheet-with-redemptions.csv", secondUnredeem);
    expect(next.conflicts[0]!.sourceKey).toBe("reredeem:unredeem:reredeem:unredeem:sheet:MT-00001:2026-10-15T17:05:09Z");
  });

  it("changes the digest when the records change under a preview", () => {
    expect(plan("sheet-with-redemptions.csv", applied(first, emptyState(), "SHEET")).digest).not.toBe(first.digest);
    expect(plan("sheet-with-redemptions.csv").digest).toBe(first.digest);
  });

  it("flags a cancelled ticket", () => {
    const cancelled = planScannerImport({
      file: parseScannerFile(fixture("sheet-with-redemptions.csv")), fileSha256: "0".repeat(64), timeZone: TZ, tickets: tickets.filter((row) => row.number !== 7),
      inactiveNumbers: new Set([7]), otherEventNumbers: new Set(), ...emptyState(),
    });
    expect(cancelled.byReason.INACTIVE_TICKET).toBe(1);
  });
});

describe("transactions.csv (matched by registration, guest, meal and local date)", () => {
  const result = plan("transactions.csv");

  it("counts only SUCCESS rows, maps DINNER to supper and uses the event-local date", () => {
    expect(result.source).toBe("TRANSACTIONS");
    expect(result.counts.notSuccess).toBe(1);
    // Alex x2 (two interchangeable tickets), Blake (UTC date is the 16th, local the 15th), Casey (formula guard).
    expect(result.redemptions.map((row) => row.ticketNumber).sort()).toEqual([1, 2, 3, 4]);
  });

  it("gives each scan its own ticket and sends the rest to review", () => {
    // A third Alex scan (all used), Drew (two kinds of ticket), a guest with no ticket, a meal that is not a café meal, a blank guest name.
    expect(result.byReason).toEqual({ ALL_USED: 1, AMBIGUOUS: 1, NO_MATCH: 1, INVALID_ROW: 2 });
    expect(result.counts.review).toBe(5);
  });

  it("keeps names and registration codes out of the stored keys and text", () => {
    for (const row of result.redemptions) {
      expect(row.sourceKey).toMatch(/^tx:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z:(BREAKFAST|LUNCH|SUPPER):[0-9a-f]{64}$/);
      expect(row.sourceKey).not.toMatch(/SYN-|alex|blake|casey/i);
      // The station that scanned it, never the guest.
      expect(row.redeemedByText).toBe("Station 1");
    }
  });

  it("numbers identical scans in the same second with a #n suffix, and a repeated key is not a new scan", () => {
    const text = [
      "timestamp,scannedValue,mealType,result,failureReason,stationName,entitlementId,entitlementPersonName",
      "2026-10-15T17:05:09.100Z,SYN-AAA1,LUNCH,SUCCESS,,Station 1,10,Alex Example",
      "2026-10-15T17:05:09.900Z,SYN-AAA1,LUNCH,SUCCESS,,Station 1,16,Alex Example",
    ].join("\r\n") + "\r\n";
    const run = (state: State) => planScannerImport({ file: parseScannerFile(text), fileSha256: sha256Hex(text), timeZone: TZ, tickets, inactiveNumbers: new Set(), otherEventNumbers: new Set(), ...state });
    const both = run(emptyState());
    expect(both.redemptions.map((row) => row.ticketNumber)).toEqual([1, 2]);
    const [one, two] = both.redemptions;
    expect(two!.sourceKey).toBe(`${one!.sourceKey}#2`);
    expect(run(applied(both, emptyState(), "TRANSACTIONS")).redemptions).toEqual([]);
  });

  it("keys on whole seconds: a re-saved copy without milliseconds matches the raw export", () => {
    const base = "timestamp,scannedValue,mealType,result,stationName,entitlementPersonName\r\n";
    const plans = ["2026-10-15T17:05:09.000Z", "2026-10-15T17:05:09Z", "2026-10-15T17:05:09.420Z"].map((stamp) => {
      const text = `${base}${stamp},SYN-AAA1,LUNCH,SUCCESS,Station 1,Alex Example\r\n`;
      return planScannerImport({ file: parseScannerFile(text), fileSha256: sha256Hex(text), timeZone: TZ, tickets, inactiveNumbers: new Set(), otherEventNumbers: new Set(), ...emptyState() });
    });
    expect(new Set(plans.map((entry) => entry.redemptions[0]!.sourceKey)).size).toBe(1);
  });

  it("is idempotent: importing the file again adds nothing", () => {
    const again = plan("transactions.csv", applied(result, emptyState(), "TRANSACTIONS"));
    expect(again.redemptions).toEqual([]);
    expect(again.counts.unchanged).toBe(4);
  });

  it("warns when the event already holds results from the other file kind", () => {
    expect(result.otherSourceHasRedemptions).toBe(false);
    expect(plan("transactions.csv", { existingSources: new Set<ScannerSource>(["SHEET"]) }).otherSourceHasRedemptions).toBe(true);
    expect(plan("sheet-with-redemptions.csv", { existingSources: new Set<ScannerSource>(["TRANSACTIONS"]) }).otherSourceHasRedemptions).toBe(true);
  });

  it("does not depend on the order the scanner exported the rows in", () => {
    const text = fixture("transactions.csv");
    const [header, ...rows] = text.trimEnd().split("\r\n");
    const reversed = [header, ...rows.reverse()].join("\r\n") + "\r\n";
    const other = planScannerImport({
      file: parseScannerFile(reversed), fileSha256: sha256Hex(reversed), timeZone: TZ, tickets, inactiveNumbers: new Set(), otherEventNumbers: new Set(), ...emptyState(),
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

  it("keeps a meal served on a ticket that was cancelled afterwards, as served and not as sold", () => {
    const withCancelled = buildServedReport(
      [...sold, { id: "t8", number: 8, mealType: "LUNCH" as const, serviceDate: "", payer: "ATTENDEE" as const, cancelled: true },
        { id: "t9", number: 9, mealType: "SUPPER" as const, serviceDate: "2026-10-16", payer: "CONFERENCE" as const, cancelled: true }],
      new Map([...served, ["t8", new Date("2026-10-15T18:00:00Z")]]),
    );
    const lunch = withCancelled.rows.find((entry) => entry.key === "any:LUNCH")!;
    expect(lunch).toMatchObject({ sold: { total: 3 }, served: { paying: 2, total: 2 }, servedOnCancelled: { total: 1 }, notUsed: { total: 2 } });
    // A cancelled ticket nobody used is not shown at all.
    expect(withCancelled.rows.find((entry) => entry.key === "2026-10-16:SUPPER")).toBeUndefined();
    expect(withCancelled.totals).toMatchObject({ sold: { total: 7 }, served: { total: 4 }, servedOnCancelled: { total: 1 }, notUsed: { total: 4 } });
    const drill = servedDrillDown([...sold, { id: "t8", number: 8, mealType: "LUNCH" as const, serviceDate: "", payer: "ATTENDEE" as const, cancelled: true }], new Map([["t8", new Date("2026-10-15T18:00:00Z")]]), "any:LUNCH", TZ);
    expect(drill.find((entry) => entry.ticketId === "MT-00008")).toMatchObject({ served: true, cancelled: true });
  });

  it("drills down to ticket ids without names", () => {
    const rows = servedDrillDown(sold, served, "any:LUNCH", TZ);
    expect(rows).toEqual([
      { ticketId: "MT-00001", payer: "ATTENDEE", served: true, servedOn: "2026-10-15", cancelled: false },
      { ticketId: "MT-00002", payer: "ATTENDEE", served: false, servedOn: "", cancelled: false },
      { ticketId: "MT-00005", payer: "ATTENDEE", served: false, servedOn: "", cancelled: false },
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
