import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  CONFERENCE_SUPPLY_ITEMS,
  billingContainerSlug,
  buildOrderLines,
  churchIdOfClubOrdersGroupKey,
  clubOrdersGroupKey,
  conferenceOrderDirectorEmail,
  conferenceOrderStaffEmail,
  directorCanCancel,
  itemsTotalCents,
  parseMoneyCents,
  parsePostageCents,
  staffCanCancel,
  staffCanFill,
  wholeCount,
} from "@/modules/club-orders/conference-orders";
import { buildClubOrdersInvoiceFigures, clubOrderInvoiceLine } from "@/modules/club-orders/conference-invoice";
import { resolveConferenceOrdersEmail } from "@/modules/club-orders/conference-email";
import { adventSourceOrderCsv, buildOrderLines as buildAdventSourceLines } from "@/modules/club-orders/domain";
import { rowsForLine } from "@/modules/invoices/invoice-layout";

const items = [
  { itemId: "pin", name: "Pathfinder Conference Pin", unitPriceCents: 275 },
  { itemId: "patch", name: "Pathfinder Shoulder Patch", unitPriceCents: 125 },
  { itemId: "adv", name: "Adventurer Shoulder Patch", unitPriceCents: 225 },
];

describe("the conference items (#1688)", () => {
  it("are the three items and prices on the conference sheet", () => {
    expect(CONFERENCE_SUPPLY_ITEMS.map((item) => [item.name, item.unitPriceCents])).toEqual([
      ["Pathfinder Shoulder Patch", 125],
      ["Pathfinder Conference Pin", 275],
      ["Adventurer Shoulder Patch", 225],
    ]);
  });
});

describe("an order's lines and total", () => {
  it("keeps only items with a quantity, in name order, at the prices given now", () => {
    const lines = buildOrderLines(items, { patch: "20", pin: 4, adv: 0, unknown: 9 });
    expect(lines.map((line) => [line.itemId, line.quantity, line.unitPriceCents, line.amountCents])).toEqual([
      ["pin", 4, 275, 1100],
      ["patch", 20, 125, 2500],
    ]);
    expect(itemsTotalCents(lines)).toBe(3600);
  });

  it("never trusts a typed count: whole, never negative, capped", () => {
    expect([wholeCount("3.9"), wholeCount(-4), wholeCount("abc"), wholeCount(null), wholeCount(1_000_000), wholeCount(" 7 ")]).toEqual([3, 0, 0, 0, 9999, 7]);
  });

  it("a price change cannot reach an order already built: the lines carry their own price", () => {
    const submitted = buildOrderLines(items, { patch: 10 });
    const repriced = buildOrderLines(items.map((item) => ({ ...item, unitPriceCents: item.unitPriceCents * 2 })), { patch: 10 });
    expect(submitted[0]!.unitPriceCents).toBe(125);
    expect(itemsTotalCents(submitted)).toBe(1250);
    expect(itemsTotalCents(repriced)).toBe(2500);
    // The invoice is built from the lines' copied price, never from the catalog.
    const line = clubOrderInvoiceLine({ orderId: "order-1", clubId: "club-1", clubName: "Test Club", lines: [{ itemName: "Pathfinder Shoulder Patch", quantity: 10, unitPriceCents: 125 }], postageCents: 0, filledAt: new Date("2026-11-08T12:00:00Z") });
    expect(line.amountCents).toBe(1250);
  });
});

describe("postage and prices as typed", () => {
  it.each([["4.50", 450], ["$4.50", 450], ["1,234.5", 123450], ["0", 0], ["", 0], ["12", 1200], [450, 450]])("reads %j as %i cents", (typed, cents) => {
    expect(parseMoneyCents(typed)).toBe(cents);
    expect(parsePostageCents(typed)).toBe(cents);
  });

  it.each(["abc", "-2", "1.234", "4,5.00x", "10000.01", 1.5, -1, null, undefined, {}])("refuses %j", (typed) => {
    expect(parseMoneyCents(typed)).toBeNull();
  });
});

describe("who can do what with an order", () => {
  it("a director cancels only while Submitted; staff fill or cancel only a Submitted order", () => {
    expect(directorCanCancel("SUBMITTED")).toBe(true);
    expect(directorCanCancel("FILLED")).toBe(false);
    expect(directorCanCancel("CANCELLED")).toBe(false);
    expect([staffCanFill("SUBMITTED"), staffCanFill("FILLED"), staffCanFill("CANCELLED")]).toEqual([true, false, false]);
    expect([staffCanCancel("SUBMITTED"), staffCanCancel("FILLED"), staffCanCancel("CANCELLED")]).toEqual([true, false, false]);
  });
});

describe("the emails", () => {
  const input = {
    clubName: "Test Pathfinders",
    churchName: "Sample SDA Church",
    directorName: "Test Director",
    directorEmail: "director@example.test",
    lines: [{ name: "Pathfinder Shoulder Patch", quantity: 20, unitPriceCents: 125 }],
    patchesToExchange: 7,
    itemsTotalCents: 2500,
    reviewUrl: "https://events.imsda.test/admin/club-supplies/conference-orders",
  };

  it("the order email lists the club, church, director, items, exchanges and total, and says postage is not included", () => {
    const { subject, bodyText } = conferenceOrderStaffEmail(input);
    expect(subject).toBe("Conference club order: Test Pathfinders");
    for (const text of ["Test Pathfinders", "Sample SDA Church", "Test Director", "Pathfinder Shoulder Patch: 20 at $1.25 = $25.00", "to exchange: 7", "$25.00", "postage not included", input.reviewUrl]) {
      expect(bodyText).toContain(text);
    }
  });

  it("the director's confirmation says who is billed and that they can cancel until it is filled", () => {
    const { subject, bodyText } = conferenceOrderDirectorEmail(input);
    expect(subject).toContain("Test Pathfinders");
    expect(bodyText).toContain("billed to Sample SDA Church");
    expect(bodyText).toContain("cancel it from the club's Orders tab until the youth department fills it");
  });

  it("neutralizes template sentinels typed into a club name", () => {
    expect(conferenceOrderStaffEmail({ ...input, clubName: "{{account_action_link}}" }).bodyText).not.toContain("{{");
  });

  it("goes to the conference orders setting, else the youth department address", () => {
    expect(resolveConferenceOrdersEmail("orders@imsda.test")).toBe("orders@imsda.test");
    expect(resolveConferenceOrdersEmail("  ")).toBe("youth@imsda.org");
    expect(resolveConferenceOrdersEmail(null)).toBe("youth@imsda.org");
  });
});

describe("the church invoice for filled orders", () => {
  const filledAt = new Date("2026-11-08T12:00:00Z");
  const order = (id: string, quantity: number, postageCents: number, at = filledAt) => ({
    orderId: id,
    clubId: `club-${id}`,
    clubName: `Club ${id}`,
    lines: [{ itemName: "Pathfinder Shoulder Patch", quantity, unitPriceCents: 125 }],
    postageCents,
    filledAt: at,
  });
  const base = { event: { id: "event-1", name: "Conference club orders 2026-27" }, church: { id: "church-1", name: "Sample SDA Church" } };

  it("has one line per filled order, with each item and the postage as its own charge", () => {
    const figures = buildClubOrdersInvoiceFigures({ ...base, orders: [order("order-aaaa1111", 20, 450)] });
    expect(figures.snapshot.kind).toBe("CLUB_ORDERS");
    expect(figures.snapshot.groupKey).toBe("club-orders:church-1");
    expect(figures.snapshot.reconciliation).toBeNull();
    expect(figures.amountDueCents).toBe(2500 + 450);
    const [line] = figures.snapshot.lines;
    expect(line!.chargesNotTiedToPerson.map((charge) => [charge.label, charge.amountCents])).toEqual([
      ["Pathfinder Shoulder Patch, 20 at $1.25", 2500],
      ["Postage", 450],
    ]);
    expect(line!.label).toContain("Club order-aaaa1111");
    // The printed invoice rows add up to the line.
    expect(rowsForLine(line!).reduce((total, row) => total + row.amountCents, 0)).toBe(line!.amountCents);
  });

  it("adds no postage line when there is none, and leaves out an order worth $0", () => {
    const figures = buildClubOrdersInvoiceFigures({ ...base, orders: [order("a", 4, 0), order("b", 0, 0)] });
    expect(figures.snapshot.lines).toHaveLength(1);
    expect(figures.snapshot.lines[0]!.chargesNotTiedToPerson.map((charge) => charge.label)).toEqual(["Pathfinder Shoulder Patch, 4 at $1.25"]);
  });

  it("is the same figures whatever order the orders are given in, and a new order changes the fingerprint", () => {
    const early = order("order-1", 2, 0, new Date("2026-11-01T12:00:00Z"));
    const late = order("order-2", 3, 100, new Date("2026-11-05T12:00:00Z"));
    const one = buildClubOrdersInvoiceFigures({ ...base, orders: [early, late] });
    const two = buildClubOrdersInvoiceFigures({ ...base, orders: [late, early] });
    expect(one.amountsFingerprint).toBe(two.amountsFingerprint);
    expect(one.snapshot.lines.map((line) => line.registrationId)).toEqual(["order-1", "order-2"]);
    expect(buildClubOrdersInvoiceFigures({ ...base, orders: [early] }).amountsFingerprint).not.toBe(one.amountsFingerprint);
  });

  it("prints no member name: the snapshot holds the club, the order id and amounts", () => {
    const text = JSON.stringify(buildClubOrdersInvoiceFigures({ ...base, orders: [order("order-1", 2, 50)] }).snapshot);
    expect(text).not.toMatch(/email|phone|firstName|lastName/i);
  });

  it("names the church's group key, and reads it back only when it is one", () => {
    expect(clubOrdersGroupKey("church-1")).toBe("club-orders:church-1");
    expect(churchIdOfClubOrdersGroupKey("club-orders:church-1")).toBe("church-1");
    expect(churchIdOfClubOrdersGroupKey("club-orders:")).toBeNull();
    expect(churchIdOfClubOrdersGroupKey("church-promo:church-1")).toBeNull();
    expect(churchIdOfClubOrdersGroupKey("organization:church-1")).toBeNull();
    expect(billingContainerSlug("2026-27")).toBe("conference-club-orders-2026-27");
  });
});

describe("AdventSource never sees conference items", () => {
  it("the AdventSource quick-order file is built only from AdventSource lines, and the repository filters on supplier everywhere it reads", () => {
    const lines = buildAdventSourceLines(
      [{ itemId: "adv", name: "Camping Skills", catalogNumber: "005157" }],
      new Map([["adv", 2]]),
      new Map(),
      new Map(),
    );
    expect(adventSourceOrderCsv(lines)).toContain("005157");
    const source = readFileSync("modules/club-orders/repository.ts", "utf8");
    // The needs behind the order list, the placed order, the helper overrides and the extra-item read each carry the supplier filter.
    expect(source.match(/adventSourceItemOnly|needsOnAdventSourceList/g)!.length).toBeGreaterThanOrEqual(7);
    expect(source).toContain('item.supplier === "CONFERENCE"');
  });
});

describe("the hidden billing event", () => {
  it("every list that could show it leaves it out", () => {
    const read = (path: string) => readFileSync(path, "utf8");
    expect(read("modules/events/archive-repository.ts")).toContain("isBillingContainer: false");
    expect(read("modules/events/archive-repository.ts")).toContain("isBillingContainer) throw new EventArchiveForbiddenError");
    expect(read("modules/communications/central-email-preview.ts")).toContain("isBillingContainer: false");
    expect(read("app/(workspace)/event-setup/copy/page.tsx")).toContain("!event.isBillingContainer");
    expect(read("app/(workspace)/admin/event-templates/from-event/page.tsx")).toContain("!event.isBillingContainer");
  });

  it("is made archived, unpublished and off the calendar", () => {
    const source = readFileSync("modules/club-orders/conference-repository.ts", "utf8");
    expect(source).toMatch(/isPublished: false,\s+showOnCalendar: false,\s+archivedAt: new Date\(\),/);
    expect(source).toContain("isBillingContainer: true");
  });
});

describe("the migration (#1688)", () => {
  const sql = readFileSync("prisma/migrations/20270107100000_conference_club_orders/migration.sql", "utf8");

  it("is additive: no drop of a table or column, defaults on every new column", () => {
    expect(sql).not.toMatch(/DROP (TABLE|COLUMN)/i);
    expect(sql).toContain('ADD COLUMN     "supplier" "ClubSupplier" NOT NULL DEFAULT \'ADVENTSOURCE\'');
    expect(sql).toContain('"isBillingContainer" BOOLEAN NOT NULL DEFAULT false');
    expect(sql).toContain("ALTER TYPE \"InvoiceVersionBasis\" ADD VALUE 'CLUB_ORDERS'");
  });

  it("lets only the two non-reconciliation bases omit a reconciliation, and keeps prices conference-only", () => {
    expect(sql).toContain(`"basis"::text IN ('CHURCH_PROMO_CODES', 'CLUB_ORDERS')`);
    expect(sql).toContain(`"supplier"::text = 'CONFERENCE' AND "unitPriceCents" >= 0`);
  });
});
