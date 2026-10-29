import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  itemFindUnique: vi.fn(),
  itemFindMany: vi.fn(),
  needFindMany: vi.fn(),
  needGroupBy: vi.fn(),
  stockFindMany: vi.fn(),
  lineFindMany: vi.fn(),
  lineUpsert: vi.fn(),
  lineDeleteMany: vi.fn(),
  orgFindUnique: vi.fn(),
  honorLineFindMany: vi.fn(),
  honorLineUpsert: vi.fn(),
  honorLineDeleteMany: vi.fn(),
  honorFindUnique: vi.fn(),
  honorFindMany: vi.fn(),
  executeRaw: vi.fn(),
  writeAuditLog: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/lib/prisma", () => {
  const client = {
    clubSupplyItem: { findUnique: mocks.itemFindUnique, findMany: mocks.itemFindMany },
    clubOrderNeed: { findMany: mocks.needFindMany, groupBy: mocks.needGroupBy },
    clubSupplyStock: { findMany: mocks.stockFindMany },
    clubOrderListLine: { findMany: mocks.lineFindMany, upsert: mocks.lineUpsert, deleteMany: mocks.lineDeleteMany },
    organization: { findUnique: mocks.orgFindUnique },
    clubOrderHonorLine: { findMany: mocks.honorLineFindMany, upsert: mocks.honorLineUpsert, deleteMany: mocks.honorLineDeleteMany },
    honor: { findUnique: mocks.honorFindUnique, findMany: mocks.honorFindMany },
    $executeRaw: mocks.executeRaw,
    $transaction: (work: (tx: unknown) => unknown) => work(client),
  };
  return { getPrisma: () => client };
});

import { listHelperLines, listOrderableUnlinkedHonors, loadOrderExportHeader, ClubOrderError, setOrderHonorLineQuantity, setOrderListQuantity } from "@/modules/club-orders/repository";

const actor = { accountId: "director-1" };
const knots = { id: "knots", name: "Knot Tying", catalogNumber: "002120", section: "OUTDOOR_INDUSTRIES", sizeLabel: null };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.itemFindUnique.mockResolvedValue({ isActive: true });
  mocks.needFindMany.mockResolvedValue([]);
  mocks.needGroupBy.mockResolvedValue([]);
  mocks.stockFindMany.mockResolvedValue([]);
  mocks.lineFindMany.mockResolvedValue([]);
  mocks.itemFindMany.mockResolvedValue([]);
  mocks.honorLineFindMany.mockResolvedValue([]);
  mocks.honorFindUnique.mockResolvedValue({ isActive: true, clubSupplyItems: [] });
});

describe("setOrderListQuantity (#654)", () => {
  it("saves a quantity under the club's lock and audits the numbers only", async () => {
    await expect(setOrderListQuantity("club-1", "knots", 4, actor)).resolves.toEqual({ itemId: "knots", quantity: 4 });
    expect(mocks.executeRaw).toHaveBeenCalled();
    expect(mocks.lineUpsert).toHaveBeenCalledWith({
      where: { organizationId_itemId: { organizationId: "club-1", itemId: "knots" } },
      create: { organizationId: "club-1", itemId: "knots", quantity: 4 },
      update: { quantity: 4 },
    });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "CLUB_ORDER_LIST_LINE_SET", metadata: expect.objectContaining({ organizationId: "club-1", itemId: "knots", quantity: 4 }) }),
      expect.anything(),
    );
  });

  it("null puts the line back by deleting the edit", async () => {
    await setOrderListQuantity("club-1", "knots", null, actor);
    expect(mocks.lineDeleteMany).toHaveBeenCalledWith({ where: { organizationId: "club-1", itemId: "knots" } });
    expect(mocks.lineUpsert).not.toHaveBeenCalled();
  });

  it("refuses an unknown item, and an inactive one unless resetting", async () => {
    mocks.itemFindUnique.mockResolvedValue(null);
    await expect(setOrderListQuantity("club-1", "nope", 1, actor)).rejects.toBeInstanceOf(ClubOrderError);
    mocks.itemFindUnique.mockResolvedValue({ isActive: false });
    await expect(setOrderListQuantity("club-1", "old", 1, actor)).rejects.toBeInstanceOf(ClubOrderError);
    await expect(setOrderListQuantity("club-1", "old", null, actor)).resolves.toEqual({ itemId: "old", quantity: null });
    expect(mocks.lineUpsert).not.toHaveBeenCalled();
  });
});

describe("listHelperLines (#654)", () => {
  const need = (id: string) => ({
    id, sourceType: "HONOR", sourceId: id, personId: `p-${id}`, itemId: "knots", sourceLabel: "", sourceDate: "2026-09-01", createdAt: new Date(0), item: knots,
  });

  it("counts needs per item and subtracts the club's stock, so a saved inventory edit lowers to order", async () => {
    mocks.needFindMany.mockResolvedValue([need("a"), need("b"), need("c")]);
    const before = await listHelperLines("club-1");
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ itemId: "knots", section: "HONORS", needed: 3, onHand: 0, toOrder: 3 });

    mocks.stockFindMany.mockResolvedValue([{ itemId: "knots", quantityOnHand: 2 }]);
    const after = await listHelperLines("club-1");
    expect(after[0]).toMatchObject({ needed: 3, onHand: 2, toOrder: 1 });
  });

  it("applies a saved edit, and adds an item nothing calls for", async () => {
    mocks.needFindMany.mockResolvedValue([need("a")]);
    mocks.lineFindMany.mockResolvedValue([{ itemId: "knots", quantity: 6 }, { itemId: "star", quantity: 2 }]);
    mocks.itemFindMany.mockResolvedValue([{ id: "star", section: "MISCELLANEOUS", name: "Good Conduct Star", catalogNumber: "000123", sizeLabel: null }]);
    const lines = await listHelperLines("club-1");
    expect(lines.map((line) => [line.itemId, line.section, line.computedNeeded, line.needed, line.edited])).toEqual([
      ["knots", "HONORS", 1, 6, true],
      ["star", "OTHER", 0, 2, true],
    ]);
  });
});

describe("loadOrderExportHeader (#654)", () => {
  it("uses the club profile's contact first and never the director account's personal phone", async () => {
    mocks.orgFindUnique.mockResolvedValue({
      name: "Test Pathfinders",
      parentOrganization: { name: "Sample Church" },
      clubProfile: { contactEmail: "club@example.test", contactPhone: "555-0199" },
      directorGrants: [{ attendeeAccount: { displayName: "Test Director", email: "director@example.test" } }],
    });
    const header = await loadOrderExportHeader("club-1", new Date("2026-09-30T18:00:00Z"));
    expect(header).toEqual({
      clubName: "Test Pathfinders",
      church: "Sample Church",
      directorName: "Test Director",
      directorEmail: "club@example.test",
      directorPhone: "555-0199",
      date: "2026-09-30",
    });
  });

  it("falls back to the director account's name and email only, leaving the phone blank", async () => {
    mocks.orgFindUnique.mockResolvedValue({
      name: "Test Pathfinders",
      parentOrganization: { name: "Sample Church" },
      clubProfile: { contactEmail: "", contactPhone: "" },
      directorGrants: [{ attendeeAccount: { displayName: "Test Director", email: "director@example.test", phone: "555-0000" } }],
    });
    const header = await loadOrderExportHeader("club-1", new Date("2026-09-30T18:00:00Z"));
    expect(header).toMatchObject({ directorName: "Test Director", directorEmail: "director@example.test", directorPhone: "" });
    expect(mocks.orgFindUnique.mock.calls[0][0].select.directorGrants.select.attendeeAccount.select).not.toHaveProperty("phone");
  });

  it("is blank, not an error, for a club with no director or church on file", async () => {
    mocks.orgFindUnique.mockResolvedValue({ name: "Test Pathfinders", parentOrganization: null, clubProfile: null, directorGrants: [] });
    expect(await loadOrderExportHeader("club-1", new Date("2026-09-30T18:00:00Z"))).toMatchObject({ church: "", directorName: "", directorEmail: "", directorPhone: "" });
  });
});

describe("setOrderHonorLineQuantity (#1330)", () => {
  it("adds or changes a line for an active honor with no catalog item, under the club's lock, audited with ids and the number only", async () => {
    await expect(setOrderHonorLineQuantity("club-1", "honor-1", 4, actor)).resolves.toEqual({ honorId: "honor-1", quantity: 4 });
    expect(mocks.executeRaw).toHaveBeenCalled();
    expect(mocks.honorLineUpsert).toHaveBeenCalledWith({
      where: { organizationId_honorId: { organizationId: "club-1", honorId: "honor-1" } },
      create: { organizationId: "club-1", honorId: "honor-1", quantity: 4 },
      update: { quantity: 4 },
    });
    const audit = mocks.writeAuditLog.mock.calls[0][0];
    expect(audit).toMatchObject({ action: "CLUB_ORDER_HONOR_LINE_SET", entityType: "ClubOrderHonorLine" });
    expect(audit.metadata).toMatchObject({ organizationId: "club-1", honorId: "honor-1", quantity: 4 });
    expect(JSON.stringify(audit)).not.toMatch(/firstName|lastName|personId/);
  });

  it("removes the line with 0 or null, with no honor lookup", async () => {
    await expect(setOrderHonorLineQuantity("club-1", "honor-1", 0, actor)).resolves.toEqual({ honorId: "honor-1", quantity: 0 });
    await expect(setOrderHonorLineQuantity("club-1", "honor-1", null, actor)).resolves.toEqual({ honorId: "honor-1", quantity: 0 });
    expect(mocks.honorLineDeleteMany).toHaveBeenCalledTimes(2);
    expect(mocks.honorLineDeleteMany).toHaveBeenCalledWith({ where: { organizationId: "club-1", honorId: "honor-1" } });
    expect(mocks.honorLineUpsert).not.toHaveBeenCalled();
    expect(mocks.honorFindUnique).not.toHaveBeenCalled();
  });

  it("refuses an unknown honor, an inactive honor, and an honor that has a catalog item now, writing nothing", async () => {
    mocks.honorFindUnique.mockResolvedValue(null);
    await expect(setOrderHonorLineQuantity("club-1", "nope", 1, actor)).rejects.toMatchObject({ code: "HONOR_NOT_FOUND" });
    mocks.honorFindUnique.mockResolvedValue({ isActive: false, clubSupplyItems: [] });
    await expect(setOrderHonorLineQuantity("club-1", "old", 1, actor)).rejects.toMatchObject({ code: "HONOR_NOT_ORDERABLE" });
    mocks.honorFindUnique.mockResolvedValue({ isActive: true, clubSupplyItems: [{ id: "knots" }] });
    await expect(setOrderHonorLineQuantity("club-1", "linked", 1, actor)).rejects.toMatchObject({ code: "HONOR_HAS_CATALOG_ITEM" });
    expect(mocks.honorLineUpsert).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });
});

describe("listHelperLines with honors added by hand (#1330)", () => {
  const need = (id: string) => ({
    id, sourceType: "HONOR", sourceId: id, personId: `p-${id}`, itemId: "knots", sourceLabel: "", sourceDate: "2026-09-01", createdAt: new Date(0), item: knots,
  });
  const honorRow = (honorId: string, name: string, quantity: number, linkedItemId?: string) => ({
    honorId, quantity, honor: { name, clubSupplyItems: linkedItemId ? [{ id: linkedItemId }] : [] },
  });

  it("lists an unlinked honor line with no item and no stock, To order equal to the quantity", async () => {
    mocks.honorLineFindMany.mockResolvedValue([honorRow("honor-arch", "Archery", 5)]);
    const lines = await listHelperLines("club-1");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ itemId: null, honorId: "honor-arch", section: "HONORS", name: "Archery", catalogNumber: null, needed: 5, toOrder: 5 });
  });

  it("shows a line whose honor was linked later as that catalog item, with no second line", async () => {
    mocks.needFindMany.mockResolvedValue([need("a")]);
    mocks.honorLineFindMany.mockResolvedValue([honorRow("honor-knots", "Knot Tying", 4, "knots")]);
    mocks.stockFindMany.mockResolvedValue([{ itemId: "knots", quantityOnHand: 1 }]);
    const lines = await listHelperLines("club-1");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ itemId: "knots", honorId: null, computedNeeded: 1, needed: 4, edited: true, onHand: 1, toOrder: 3 });
  });

  it("brings in a linked honor's item even when nothing else calls for it", async () => {
    mocks.honorLineFindMany.mockResolvedValue([honorRow("honor-star", "Good Conduct", 2, "star")]);
    mocks.itemFindMany.mockResolvedValue([{ id: "star", section: "MISCELLANEOUS", name: "Good Conduct Star", catalogNumber: "000123", sizeLabel: null }]);
    const lines = await listHelperLines("club-1");
    expect(lines.map((line) => [line.itemId, line.honorId, line.needed])).toEqual([["star", null, 2]]);
  });

  it("lets the catalog item's own line win when both exist", async () => {
    mocks.needFindMany.mockResolvedValue([need("a")]);
    mocks.lineFindMany.mockResolvedValue([{ itemId: "knots", quantity: 6 }]);
    mocks.honorLineFindMany.mockResolvedValue([honorRow("honor-knots", "Knot Tying", 4, "knots")]);
    const lines = await listHelperLines("club-1");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ itemId: "knots", needed: 6 });
  });
});

describe("listOrderableUnlinkedHonors (#1330)", () => {
  it("asks only for active honors with no active catalog item and returns names and ids only", async () => {
    mocks.honorFindMany.mockResolvedValue([{ id: "h1", name: "Archery" }]);
    await expect(listOrderableUnlinkedHonors()).resolves.toEqual([{ honorId: "h1", name: "Archery" }]);
    expect(mocks.honorFindMany.mock.calls[0][0].where).toEqual({ isActive: true, clubSupplyItems: { none: { isActive: true } } });
  });
});
