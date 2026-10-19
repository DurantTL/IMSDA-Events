import { describe, expect, it } from "vitest";
import { effectivePermissions } from "@/modules/access/authorization";
import { eventPermissions, rolePermissions } from "@/modules/access/permissions";
import {
  buildKitchenCountsReport, currentEntries, kitchenCountInputSchema, kitchenCountsCsv, parseServiceKey, type KitchenCountEntry,
} from "@/modules/meals/kitchen-counts";
import { buildServedReport, type ServedTicket } from "@/modules/meals/served-report";
import { viewerMaySearchEvent } from "@/modules/registrations/operations-search-domain";

const ticket = (id: string, number: number, mealType: ServedTicket["mealType"], serviceDate: string, payer: ServedTicket["payer"] = "ATTENDEE"): ServedTicket =>
  ({ id, number, mealType, serviceDate, payer });
const tickets = [
  ticket("t1", 1, "LUNCH", "2026-10-15"), ticket("t2", 2, "LUNCH", "2026-10-15"), ticket("t3", 3, "LUNCH", "2026-10-15", "CONFERENCE"),
  ticket("t4", 4, "SUPPER", "2026-10-15"),
];
const served = new Map([["t1", new Date("2026-10-15T17:00:00Z")], ["t3", new Date("2026-10-15T17:05:00Z")]]);
const servedReport = buildServedReport(tickets, served);

let counter = 0;
function entry(over: Partial<KitchenCountEntry> & Pick<KitchenCountEntry, "kind" | "quantity">): KitchenCountEntry {
  counter += 1;
  return {
    id: `e${counter}`, serviceDate: "2026-10-15", mealType: "LUNCH", note: null, enteredBy: "Kim Kitchen",
    enteredAt: `2026-10-15T18:${String(counter).padStart(2, "0")}:00.000Z`, supersedesId: null, ...over,
  };
}

describe("kitchen counts report (#1029)", () => {
  it("keeps ordered, served, prepared, wasted, donated and transferred as separate figures", () => {
    const report = buildKitchenCountsReport(servedReport, [
      entry({ kind: "PREPARED", quantity: 5 }), entry({ kind: "WASTED", quantity: 1 }),
      entry({ kind: "DONATED", quantity: 2 }), entry({ kind: "TRANSFERRED", quantity: 3 }),
    ]);
    const lunch = report.rows.find((row) => row.key === "2026-10-15:LUNCH")!;
    expect(lunch).toMatchObject({ ordered: 3, served: 2 });
    expect(Object.fromEntries(Object.entries(lunch.counts).map(([kind, cell]) => [kind, cell.quantity]))).toEqual({ PREPARED: 5, WASTED: 1, DONATED: 2, TRANSFERRED: 3 });
    // Nothing entered for supper: absent, not zero, and served is untouched by the lunch entries.
    const supper = report.rows.find((row) => row.key === "2026-10-15:SUPPER")!;
    expect(supper).toMatchObject({ ordered: 1, served: 0, counts: {}, variance: null });
  });

  it("never lets prepared overwrite served", () => {
    const before = buildKitchenCountsReport(servedReport, []).rows.map((row) => row.served);
    const after = buildKitchenCountsReport(servedReport, [entry({ kind: "PREPARED", quantity: 99 }), entry({ kind: "PREPARED", quantity: 98, supersedesId: "e1" })]).rows.map((row) => row.served);
    expect(after).toEqual(before);
    expect(servedReport.rows.find((row) => row.key === "2026-10-15:LUNCH")!.served.total).toBe(2);
  });

  it("computes variance as prepared minus served, blank until prepared is entered", () => {
    const report = buildKitchenCountsReport(servedReport, [entry({ kind: "PREPARED", quantity: 5 }), entry({ kind: "WASTED", quantity: 4 })]);
    expect(report.rows.find((row) => row.key === "2026-10-15:LUNCH")!.variance).toBe(3);
    expect(report.rows.find((row) => row.key === "2026-10-15:SUPPER")!.variance).toBeNull();
    // Wasted entered but prepared not: no variance, never a guess.
    expect(buildKitchenCountsReport(servedReport, [entry({ kind: "WASTED", quantity: 4 })]).rows[0]!.variance).toBeNull();
    // Fewer prepared than served is a negative variance, and zero prepared is a real zero.
    expect(buildKitchenCountsReport(servedReport, [entry({ kind: "PREPARED", quantity: 0 })]).rows[0]!.variance).toBe(-2);
    expect(report.totals.variance).toBe(3);
  });

  it("totals a partly entered report honestly: no entries is not zero, and variance covers only services with prepared", () => {
    const report = buildKitchenCountsReport(servedReport, [entry({ kind: "PREPARED", quantity: 1 }), entry({ kind: "WASTED", quantity: 2 })]);
    // Lunch has prepared (1) with 2 served; supper has nothing entered and 0 served, and is left out of the variance.
    expect(report.totals).toMatchObject({
      ordered: 4, served: 2, counts: { PREPARED: 1, WASTED: 2, DONATED: null, TRANSFERRED: null },
      variance: -1, varianceServices: 1, varianceServed: 2,
    });
    const csv = kitchenCountsCsv(report).replace("\uFEFF", "").trimEnd().split("\r\n");
    // A negative variance stays a number, and the totals row says which services it covers.
    expect(csv[1]).toMatch(/^"2026-10-15 · Lunch","3","2","1","2","","","-1",/);
    expect(csv.at(-1)).toBe('"All services","4","2","1","2","","","-1","Variance covers only the 1 service with prepared entered (served there: 2)."');
    const none = buildKitchenCountsReport(servedReport, []);
    expect(none.totals).toMatchObject({ counts: { PREPARED: null, WASTED: null, DONATED: null, TRANSFERRED: null }, variance: null, varianceServices: 0 });
    expect(kitchenCountsCsv(none).trimEnd().split("\r\n").at(-1)).toBe('"All services","4","2","","","","","",""');
  });

  it("shows a correction as the current figure and keeps the earlier entry in the history", () => {
    const first = entry({ kind: "PREPARED", quantity: 5, note: "First pan" });
    const second = entry({ kind: "PREPARED", quantity: 7, supersedesId: first.id, note: "Recount", enteredBy: "Lee Lead" });
    const report = buildKitchenCountsReport(servedReport, [second, first]);
    const lunch = report.rows.find((row) => row.key === "2026-10-15:LUNCH")!;
    expect(lunch.counts.PREPARED).toMatchObject({ quantity: 7, note: "Recount", enteredBy: "Lee Lead", entryId: second.id });
    expect(lunch.history.map((item) => [item.quantity, item.superseded, item.enteredBy])).toEqual([[5, true, "Kim Kitchen"], [7, false, "Lee Lead"]]);
    expect(currentEntries([first, second]).map((item) => item.id)).toEqual([second.id]);
    expect(report.totals.counts.PREPARED).toBe(7);
    expect(report.totals.counts.WASTED).toBeNull();
  });

  it("lists a service the kitchen entered counts for even when it has no tickets", () => {
    const report = buildKitchenCountsReport({ rows: [] }, [entry({ kind: "DONATED", quantity: 4, serviceDate: "", mealType: "SUPPER" })]);
    expect(report.rows).toEqual([expect.objectContaining({ key: "any:SUPPER", label: "Any day · Supper", ordered: 0, served: 0 })]);
    expect(buildKitchenCountsReport({ rows: [] }, []).rows).toEqual([]);
  });

  it("writes a CSV with every column apart, and defuses formulas in notes", () => {
    const csv = kitchenCountsCsv(buildKitchenCountsReport(servedReport, [
      entry({ kind: "PREPARED", quantity: 5, note: "=HYPERLINK(\"http://evil.example\")" }), entry({ kind: "WASTED", quantity: 1, note: "+1 pan, burnt" }),
    ]));
    const lines = csv.replace("﻿", "").trimEnd().split("\r\n");
    expect(lines[0]).toBe('"Service","Ordered (tickets sold)","Served (scanner)","Prepared","Wasted","Donated","Transferred","Variance (prepared minus served)","Notes"');
    expect(lines[1]).toMatch(/^"2026-10-15 · Lunch","3","2","5","1","","","3","/);
    // Each note is written after its column label and quotes are doubled, so no cell starts with a formula character.
    expect(lines[1]).toContain('"Prepared: =HYPERLINK(""http://evil.example"") | Wasted: +1 pan, burnt"');
    expect(lines[1]).not.toMatch(/(^|,)"[=+\-@\t\r]/);
    expect(lines.at(-1)).toMatch(/^"All services"/);
    for (const cell of csv.split(/,(?=")/)) expect(cell.replace(/^"/, "")).not.toMatch(/^[=+\-@]/);
  });

});

describe("kitchen count input", () => {
  const valid = { serviceKey: "2026-10-15:LUNCH", kind: "PREPARED", quantity: 5, note: " Hot ", supersedesId: null };
  it("accepts a whole number from zero and trims the note", () => {
    expect(kitchenCountInputSchema.parse(valid)).toMatchObject({ quantity: 5, note: "Hot" });
    expect(kitchenCountInputSchema.parse({ ...valid, quantity: 0, note: "  " }).note).toBeNull();
  });
  it.each([
    { quantity: -1 }, { quantity: 1.5 }, { quantity: "5" }, { quantity: 100001 }, { kind: "SERVED" }, { serviceKey: "2026-13-40:LUNCH" }, { serviceKey: "any:SNACK" },
    { note: "x".repeat(501) }, { eventId: "other" },
  ])("refuses %j", (change) => {
    const result = kitchenCountInputSchema.safeParse({ ...valid, ...change });
    // A well-formed key with an impossible date passes the schema's pattern and is refused by parseServiceKey.
    if (result.success) expect(parseServiceKey((change as { serviceKey: string }).serviceKey)).toBeNull();
    else expect(result.success).toBe(false);
  });
  it("parses service keys", () => {
    expect(parseServiceKey("2026-10-15:LUNCH")).toEqual({ serviceDate: "2026-10-15", mealType: "LUNCH" });
    expect(parseServiceKey("any:SUPPER")).toEqual({ serviceDate: "", mealType: "SUPPER" });
    expect(parseServiceKey("2026-02-30:LUNCH")).toBeNull();
  });
});

describe("the Kitchen staff role", () => {
  it("holds only the kitchen counts permission, so no registration, people, finance, report or event view", () => {
    expect(rolePermissions.KITCHEN_STAFF).toEqual(["MANAGE_KITCHEN_COUNTS"]);
    const held = effectivePermissions({ id: "u", email: "k@example.test", displayName: "K" }, { eventId: "e", userId: "u", role: "KITCHEN_STAFF", status: "ACTIVE", permissions: [] });
    expect(held).toEqual(["MANAGE_KITCHEN_COUNTS"]);
    // VIEW_EVENT is what opens the registration search, so the viewer cannot search.
    expect(viewerMaySearchEvent({ eventId: "e", permissions: held })).toBe(false);
  });
  it("is carried by Event Admin and by no other role", () => {
    expect(eventPermissions).toContain("MANAGE_KITCHEN_COUNTS");
    expect(rolePermissions.EVENT_ADMIN).toContain("MANAGE_KITCHEN_COUNTS");
    for (const [role, held] of Object.entries(rolePermissions)) {
      if (role !== "EVENT_ADMIN" && role !== "KITCHEN_STAFF") expect(held).not.toContain("MANAGE_KITCHEN_COUNTS");
    }
  });
});
