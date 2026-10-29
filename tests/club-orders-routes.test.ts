import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The club order routes behind the real roster gate (#487, same as #531's
 * club supplies): neither `modules/club-orders/access` (there is none — it
 * reuses `modules/club-supplies/access`) nor `modules/club-rosters/access` is
 * mocked. Only the lookups underneath and the order storage are stubbed.
 */
const mocks = vi.hoisted(() => ({
  getCurrentAttendee: vi.fn(),
  listDirectedClubs: vi.fn(),
  findEnrollment: vi.fn(),
  findSession: vi.fn(),
  countPasskeys: vi.fn(),
  findSettings: vi.fn(),
  findAreaGrant: vi.fn(),
  findOrganization: vi.fn(),
  loadOrderWorkspace: vi.fn(),
  setOrderListQuantity: vi.fn(),
  setOrderHonorLineQuantity: vi.fn(),
  listHelperLines: vi.fn(),
  loadOrderExportHeader: vi.fn(),
  markNeedsAwarded: vi.fn(),
  markNeedsAlreadyAwarded: vi.fn(),
  listPickList: vi.fn(),
  syncHonorOrderNeeds: vi.fn(),
  staffActing: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/attendee-accounts/sign-in-gate", () => ({ accountNeedsSecondStep: async () => "OK" }));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    attendeeMfaEnrollment: { findUnique: mocks.findEnrollment },
    attendeeSession: { findUnique: mocks.findSession },
    attendeePasskey: { count: mocks.countPasskeys },
    platformSettings: { findUnique: mocks.findSettings },
    areaCoordinatorGrant: { findUnique: mocks.findAreaGrant },
    organization: { findUnique: mocks.findOrganization },
  }),
}));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: mocks.getCurrentAttendee }));
vi.mock("@/modules/organizations/director-access", () => ({ listDirectedClubs: mocks.listDirectedClubs }));
vi.mock("@/modules/organizations/staff-act-as", () => ({ currentStaffActingContext: () => mocks.staffActing() }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: () => null }));
vi.mock("@/modules/honors/order-source", () => ({ syncHonorOrderNeeds: mocks.syncHonorOrderNeeds }));
vi.mock("@/modules/club-orders/repository", async () => {
  const actual = await vi.importActual<typeof import("@/modules/club-orders/repository")>("@/modules/club-orders/repository");
  return {
    ...actual,
    loadOrderWorkspace: mocks.loadOrderWorkspace,
    setOrderListQuantity: mocks.setOrderListQuantity,
    setOrderHonorLineQuantity: mocks.setOrderHonorLineQuantity,
    listHelperLines: mocks.listHelperLines,
    loadOrderExportHeader: mocks.loadOrderExportHeader,
    markNeedsAwarded: mocks.markNeedsAwarded,
    markNeedsAlreadyAwarded: mocks.markNeedsAlreadyAwarded,
    listPickList: mocks.listPickList,
  };
});

import { GET } from "@/app/api/attendee/clubs/[organizationId]/orders/route";
import { PUT as PUT_LINE } from "@/app/api/attendee/clubs/[organizationId]/orders/lines/[itemId]/route";
import { PUT as PUT_HONOR_LINE } from "@/app/api/attendee/clubs/[organizationId]/orders/honor-lines/[honorId]/route";
import { POST as POST_AWARD } from "@/app/api/attendee/clubs/[organizationId]/orders/award/route";
import { POST as POST_ALREADY } from "@/app/api/attendee/clubs/[organizationId]/orders/already-awarded/route";
import { GET as GET_CSV } from "@/app/api/attendee/clubs/[organizationId]/orders/csv/route";
import { activeHelperLines, buildHelperLines } from "@/modules/club-orders/domain";
import { parseCsvMatrix } from "@/modules/imports/csv-parser";
import { ClubOrderError } from "@/modules/club-orders/repository";

const clubFor = (organizationId: string, role: string) => ({ organizationId, name: "Test Pathfinders", role, sponsoringChurch: null });
const account = { id: "director-1", verifiedEmail: "director@example.test", displayName: "Test Director" };
const ctx = (organizationId = "club-1") => ({ params: Promise.resolve({ organizationId }) });
const lineCtx = (organizationId = "club-1", itemId = "item-1") => ({ params: Promise.resolve({ organizationId, itemId }) });
const honorCtx = (organizationId = "club-1", honorId = "honor-1") => ({ params: Promise.resolve({ organizationId, honorId }) });
const putRequest = (body: unknown) => new Request("https://events.imsda.test/api/attendee/x", {
  method: "PUT",
  headers: { origin: "https://events.imsda.test", "content-type": "application/json" },
  body: JSON.stringify(body),
});
const getRequest = () => new Request("https://events.imsda.test/api/attendee/x");
const postRequest = (body: unknown) => new Request("https://events.imsda.test/api/attendee/x", {
  method: "POST",
  headers: { origin: "https://events.imsda.test", "content-type": "application/json" },
  body: JSON.stringify(body),
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getCurrentAttendee.mockResolvedValue({ account, via: "attendee", sessionId: "session-1" });
  mocks.listDirectedClubs.mockResolvedValue([clubFor("club-1", "DIRECTOR")]);
  mocks.findEnrollment.mockResolvedValue({ status: "ACTIVE" });
  mocks.findSession.mockResolvedValue({ secondFactorVerifiedAt: new Date(Date.now() - 60_000) });
  mocks.countPasskeys.mockResolvedValue(0);
  mocks.findSettings.mockResolvedValue({ passkeyRpId: null });
  mocks.findAreaGrant.mockResolvedValue(null);
  mocks.findOrganization.mockResolvedValue({ type: "CLUB", isActive: true });
  mocks.staffActing.mockResolvedValue(null);
  mocks.syncHonorOrderNeeds.mockResolvedValue({ count: 0 });
  mocks.loadOrderWorkspace.mockResolvedValue({ helper: [], unmatched: [], awardable: [], waiting: [], firstOrderAt: null });
  mocks.setOrderListQuantity.mockResolvedValue({ itemId: "item-1", quantity: 2 });
  mocks.setOrderHonorLineQuantity.mockResolvedValue({ honorId: "honor-1", quantity: 3 });
  mocks.loadOrderExportHeader.mockResolvedValue({ clubName: "Test Pathfinders", church: "Sample Church", directorName: "Test Director", directorEmail: "director@example.test", directorPhone: "555-0100", date: "2026-09-30" });
  mocks.listHelperLines.mockResolvedValue([]);
  mocks.markNeedsAwarded.mockResolvedValue({ awarded: 1, fromStock: 0 });
  mocks.markNeedsAlreadyAwarded.mockResolvedValue({ marked: 2 });
  mocks.listPickList.mockResolvedValue([]);
});

describe("club order routes (#487, #654): permissioned like club supplies (#531)", () => {
  it.each(["DIRECTOR", "DEPUTY"])("a %s can view the order list and change a line", async (role) => {
    mocks.listDirectedClubs.mockResolvedValue([clubFor("club-1", role)]);
    const read = await GET(getRequest(), ctx());
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ canEdit: true });
    expect(mocks.syncHonorOrderNeeds).toHaveBeenCalledWith("club-1");
    const write = await PUT_LINE(putRequest({ quantity: 2 }), lineCtx());
    expect(write.status).toBe(200);
    expect(mocks.setOrderListQuantity).toHaveBeenCalledWith("club-1", "item-1", 2, { accountId: "director-1" });
  });

  it("takes a line off the list with 0 and puts it back with null", async () => {
    expect((await PUT_LINE(putRequest({ quantity: 0 }), lineCtx())).status).toBe(200);
    expect(mocks.setOrderListQuantity).toHaveBeenLastCalledWith("club-1", "item-1", 0, { accountId: "director-1" });
    expect((await PUT_LINE(putRequest({ quantity: null }), lineCtx())).status).toBe(200);
    expect(mocks.setOrderListQuantity).toHaveBeenLastCalledWith("club-1", "item-1", null, { accountId: "director-1" });
  });

  it.each([{ quantity: -1 }, { quantity: 1.5 }, { quantity: 10_001 }, { quantity: "3" }, {}, { quantity: 1, extra: 1 }])("refuses the line edit %j with 400", async (body) => {
    expect((await PUT_LINE(putRequest(body), lineCtx())).status).toBe(400);
    expect(mocks.setOrderListQuantity).not.toHaveBeenCalled();
  });

  it("a registrar views read-only and is refused changing a line", async () => {
    mocks.listDirectedClubs.mockResolvedValue([clubFor("club-1", "REGISTRAR")]);
    const read = await GET(getRequest(), ctx());
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ canEdit: false });
    // A view-only visit reads what's on file and never writes.
    expect(mocks.syncHonorOrderNeeds).not.toHaveBeenCalled();
    expect((await PUT_LINE(putRequest({ quantity: 1 }), lineCtx())).status).toBe(403);
    expect(mocks.setOrderListQuantity).not.toHaveBeenCalled();
    expect((await GET_CSV(new Request("https://events.imsda.test/x?view=list"), ctx())).status).toBe(200);
    expect(mocks.syncHonorOrderNeeds).not.toHaveBeenCalled();
    expect((await POST_ALREADY(postRequest({ needIds: ["need-1"] }), ctx())).status).toBe(403);
    expect(mocks.markNeedsAlreadyAwarded).not.toHaveBeenCalled();
  });

  it("another club's director gets 404, and nothing runs", async () => {
    const write = await PUT_LINE(putRequest({ quantity: 1 }), lineCtx("club-2"));
    expect(write.status).toBe(404);
    expect(mocks.setOrderListQuantity).not.toHaveBeenCalled();
    expect(mocks.syncHonorOrderNeeds).not.toHaveBeenCalled();
  });

  it("an Area Coordinator is refused the order list and its exports, and can't change a line or award (#918)", async () => {
    mocks.listDirectedClubs.mockResolvedValue([]);
    mocks.findAreaGrant.mockResolvedValue({ revokedAt: null, expiresAt: null });
    expect((await GET(getRequest(), ctx())).status).toBe(404);
    expect((await GET_CSV(new Request("https://events.imsda.test/x?view=list"), ctx())).status).toBe(404);
    expect((await GET_CSV(new Request("https://events.imsda.test/x?view=picklist"), ctx())).status).toBe(404);
    expect(mocks.loadOrderWorkspace).not.toHaveBeenCalled();
    expect(mocks.listHelperLines).not.toHaveBeenCalled();
    expect(mocks.listPickList).not.toHaveBeenCalled();
    expect(mocks.syncHonorOrderNeeds).not.toHaveBeenCalled();
    expect((await PUT_LINE(putRequest({ quantity: 1 }), lineCtx())).status).toBe(404);
    expect((await POST_AWARD(postRequest({ needIds: ["need-1"] }), ctx())).status).toBe(404);
    expect(mocks.setOrderListQuantity).not.toHaveBeenCalled();
    expect(mocks.markNeedsAwarded).not.toHaveBeenCalled();
  });

  it("a system administrator acting as an Area Coordinator gets 404, not 401 (#918)", async () => {
    mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
    mocks.listDirectedClubs.mockResolvedValue([]);
    mocks.staffActing.mockResolvedValue({ role: "AREA_COORDINATOR", userId: "staff-1", actAsId: "act-1" });
    expect((await GET(getRequest(), ctx())).status).toBe(404);
    expect((await GET_CSV(new Request("https://events.imsda.test/x?view=list"), ctx())).status).toBe(404);
    expect((await GET_CSV(new Request("https://events.imsda.test/x?view=picklist"), ctx())).status).toBe(404);
    expect(mocks.loadOrderWorkspace).not.toHaveBeenCalled();
    expect(mocks.listHelperLines).not.toHaveBeenCalled();
    expect(mocks.listPickList).not.toHaveBeenCalled();
    expect(mocks.syncHonorOrderNeeds).not.toHaveBeenCalled();
  });

  it("a signed-out request to the Orders routes is still 401", async () => {
    mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
    mocks.listDirectedClubs.mockResolvedValue([]);
    expect((await GET(getRequest(), ctx())).status).toBe(401);
    expect((await GET_CSV(new Request("https://events.imsda.test/x?view=list"), ctx())).status).toBe(401);
    expect((await PUT_LINE(putRequest({ quantity: 1 }), lineCtx())).status).toBe(401);
    expect((await POST_AWARD(postRequest({ needIds: ["need-1"] }), ctx())).status).toBe(401);
    expect(mocks.loadOrderWorkspace).not.toHaveBeenCalled();
  });

  it("has no route that places an order", async () => {
    const routes = await import("@/app/api/attendee/clubs/[organizationId]/orders/route");
    expect("POST" in routes).toBe(false);
  });

  it("awards needs for a director", async () => {
    const award = await POST_AWARD(postRequest({ needIds: ["need-1", "need-2"] }), ctx());
    expect(award.status).toBe(200);
    expect(mocks.markNeedsAwarded).toHaveBeenCalledWith("club-1", ["need-1", "need-2"], { accountId: "director-1" });
  });

  it("maps an unknown catalog item to 409 and a stock shortfall to 409", async () => {
    mocks.setOrderListQuantity.mockRejectedValue(new ClubOrderError("ITEM_NOT_ORDERABLE", "That catalog item could not be found."));
    expect((await PUT_LINE(putRequest({ quantity: 1 }), lineCtx())).status).toBe(409);
    mocks.markNeedsAwarded.mockRejectedValue(new ClubOrderError("NOT_ENOUGH_STOCK", "Not enough."));
    expect((await POST_AWARD(postRequest({ needIds: ["need-1"] }), ctx())).status).toBe(409);
  });

  it("marks needs already handed out for a director", async () => {
    const response = await POST_ALREADY(postRequest({ needIds: ["need-1", "need-2"] }), ctx());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ marked: 2 });
    expect(mocks.markNeedsAlreadyAwarded).toHaveBeenCalledWith("club-1", ["need-1", "need-2"], { accountId: "director-1" });
  });

  it("the list CSV carries the club details and the saved lines, grouped by section", async () => {
    const lines = buildHelperLines(
      [
        { itemId: "h1", section: "OUTDOOR_INDUSTRIES", name: "Knot Tying", catalogNumber: "002120", sizeLabel: null },
        { itemId: "u1", section: "CLASS_A_DRESS_APPAREL", name: "Boys' Shirt (M)", catalogNumber: "011112", sizeLabel: "M" },
      ],
      new Map([["h1", 3], ["u1", 2]]),
      new Map(),
      new Map([["h1", 1]]),
    );
    mocks.listHelperLines.mockResolvedValue(lines);
    const response = await GET_CSV(new Request("https://events.imsda.test/x?view=list"), ctx());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    const text = await response.text();
    expect(text).toContain('"Club","Test Pathfinders"');
    expect(text).toContain('"Church","Sample Church"');
    expect(text).toContain('"Uniforms","Boys\' Shirt","M","011112","2","2","0","2"');
    expect(text).toContain('"Honors","Knot Tying","","002120","3","3","1","2"');
    expect(text.indexOf("Uniforms")).toBeLessThan(text.indexOf("Honors"));
    // An editor's download syncs first.
    expect(mocks.syncHonorOrderNeeds).toHaveBeenCalledWith("club-1");
  });

  it("the combined export has one row per item, in the screen's order, with the same quantities and to-order totals (#1324)", async () => {
    const lines = buildHelperLines(
      [
        { itemId: "h1", section: "OUTDOOR_INDUSTRIES", name: "Knot Tying", catalogNumber: "002120", sizeLabel: null },
        { itemId: "u1", section: "CLASS_A_DRESS_APPAREL", name: "Boys' Shirt (Size 8)", catalogNumber: "011112", sizeLabel: "Size 8" },
        { itemId: "o1", section: "MISCELLANEOUS", name: "Good Conduct Star", catalogNumber: null, sizeLabel: null },
        { itemId: "h2", section: "RECREATION", name: "Camping Skills I", catalogNumber: "000450", sizeLabel: null },
      ],
      new Map([["h1", 3], ["u1", 2], ["h2", 1]]),
      new Map([["o1", 4], ["h2", 0]]),
      new Map([["h1", 1]]),
    );
    mocks.listHelperLines.mockResolvedValue(lines);
    const response = await GET_CSV(new Request("https://events.imsda.test/x?view=all"), ctx());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("order-everything.csv");
    const rows = parseCsvMatrix(await response.text());
    expect(rows[0]).toEqual(["Section", "Item name", "Item number", "Size", "Quantity", "Available", "To order"]);
    expect(rows.slice(1)).toEqual([
      ["Uniforms", "Boys' Shirt", "011112", "Size 8", "2", "0", "2"],
      ["Honors", "Knot Tying", "002120", "", "3", "1", "2"],
      ["Other supplies and insignia", "Good Conduct Star", "", "", "4", "0", "4"],
    ]);
    // Same on-screen lines (taken-off ones are left out) and the same total.
    const onScreen = activeHelperLines(lines);
    expect(rows.length - 1).toBe(onScreen.length);
    expect(rows.slice(1).reduce((sum, row) => sum + Number(row[6]), 0)).toBe(onScreen.reduce((sum, line) => sum + line.toOrder, 0));
    expect(mocks.syncHonorOrderNeeds).toHaveBeenCalledWith("club-1");
  });

  it("the combined export is refused like the other exports: Area Coordinator 404, signed-out 401, registrar read-only without syncing (#1324)", async () => {
    mocks.listDirectedClubs.mockResolvedValue([clubFor("club-1", "REGISTRAR")]);
    expect((await GET_CSV(new Request("https://events.imsda.test/x?view=all"), ctx())).status).toBe(200);
    expect(mocks.syncHonorOrderNeeds).not.toHaveBeenCalled();
    expect((await GET_CSV(new Request("https://events.imsda.test/x?view=all"), ctx("club-2"))).status).toBe(404);
    mocks.listDirectedClubs.mockResolvedValue([]);
    mocks.findAreaGrant.mockResolvedValue({ revokedAt: null, expiresAt: null });
    expect((await GET_CSV(new Request("https://events.imsda.test/x?view=all"), ctx())).status).toBe(404);
    mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
    mocks.findAreaGrant.mockResolvedValue(null);
    expect((await GET_CSV(new Request("https://events.imsda.test/x?view=all"), ctx())).status).toBe(401);
  });

  it("adding an honor by hand is the same line edit: a director adds it, a registrar and another club's director can't (#1324)", async () => {
    expect((await PUT_LINE(putRequest({ quantity: 3 }), lineCtx("club-1", "honor-item-1"))).status).toBe(200);
    expect(mocks.setOrderListQuantity).toHaveBeenCalledWith("club-1", "honor-item-1", 3, { accountId: "director-1" });
    mocks.setOrderListQuantity.mockClear();
    expect((await PUT_LINE(putRequest({ quantity: 3 }), lineCtx("club-2", "honor-item-1"))).status).toBe(404);
    mocks.listDirectedClubs.mockResolvedValue([clubFor("club-1", "REGISTRAR")]);
    expect((await PUT_LINE(putRequest({ quantity: 3 }), lineCtx("club-1", "honor-item-1"))).status).toBe(403);
    expect(mocks.setOrderListQuantity).not.toHaveBeenCalled();
  });

  describe("honors with no catalog item (#1330)", () => {
    it.each(["DIRECTOR", "DEPUTY"])("a %s adds, changes and removes an honor line", async (role) => {
      mocks.listDirectedClubs.mockResolvedValue([clubFor("club-1", role)]);
      const added = await PUT_HONOR_LINE(putRequest({ quantity: 3 }), honorCtx());
      expect(added.status).toBe(200);
      expect(await added.json()).toEqual({ line: { honorId: "honor-1", quantity: 3 } });
      expect(mocks.setOrderHonorLineQuantity).toHaveBeenLastCalledWith("club-1", "honor-1", 3, { accountId: "director-1" });
      expect((await PUT_HONOR_LINE(putRequest({ quantity: 0 }), honorCtx())).status).toBe(200);
      expect(mocks.setOrderHonorLineQuantity).toHaveBeenLastCalledWith("club-1", "honor-1", 0, { accountId: "director-1" });
      expect((await PUT_HONOR_LINE(putRequest({ quantity: null }), honorCtx())).status).toBe(200);
      expect(mocks.setOrderHonorLineQuantity).toHaveBeenLastCalledWith("club-1", "honor-1", null, { accountId: "director-1" });
      // Never touches the catalog item line.
      expect(mocks.setOrderListQuantity).not.toHaveBeenCalled();
    });

    it("a registrar gets 403, another club's director 404, a signed-out request 401, and nothing is written", async () => {
      mocks.listDirectedClubs.mockResolvedValue([clubFor("club-1", "REGISTRAR")]);
      expect((await PUT_HONOR_LINE(putRequest({ quantity: 3 }), honorCtx())).status).toBe(403);
      mocks.listDirectedClubs.mockResolvedValue([clubFor("club-1", "DIRECTOR")]);
      expect((await PUT_HONOR_LINE(putRequest({ quantity: 3 }), honorCtx("club-2"))).status).toBe(404);
      mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null });
      expect((await PUT_HONOR_LINE(putRequest({ quantity: 3 }), honorCtx())).status).toBe(401);
      expect(mocks.setOrderHonorLineQuantity).not.toHaveBeenCalled();
    });

    it.each([{ quantity: -1 }, { quantity: 1.5 }, { quantity: 10_001 }, { quantity: "3" }, {}, { quantity: 1, extra: 1 }])("refuses %j with 400", async (body) => {
      expect((await PUT_HONOR_LINE(putRequest(body), honorCtx())).status).toBe(400);
      expect(mocks.setOrderHonorLineQuantity).not.toHaveBeenCalled();
    });

    it("maps an unknown honor to 404 and an inactive or now-linked honor to 409", async () => {
      mocks.setOrderHonorLineQuantity.mockRejectedValueOnce(new ClubOrderError("HONOR_NOT_FOUND", "Missing."));
      expect((await PUT_HONOR_LINE(putRequest({ quantity: 1 }), honorCtx())).status).toBe(404);
      mocks.setOrderHonorLineQuantity.mockRejectedValueOnce(new ClubOrderError("HONOR_NOT_ORDERABLE", "Inactive."));
      expect((await PUT_HONOR_LINE(putRequest({ quantity: 1 }), honorCtx())).status).toBe(409);
      mocks.setOrderHonorLineQuantity.mockRejectedValueOnce(new ClubOrderError("HONOR_HAS_CATALOG_ITEM", "Linked."));
      expect((await PUT_HONOR_LINE(putRequest({ quantity: 1 }), honorCtx())).status).toBe(409);
    });

    it("both CSVs include the honor line with an empty item number", async () => {
      const lines = buildHelperLines(
        [{ itemId: "h1", section: "OUTDOOR_INDUSTRIES", name: "Knot Tying", catalogNumber: "002120", sizeLabel: null }],
        new Map([["h1", 3]]), new Map(), new Map(),
        [{ honorId: "honor-1", name: "Archery", quantity: 5 }],
      );
      mocks.listHelperLines.mockResolvedValue(lines);
      const list = parseCsvMatrix(await (await GET_CSV(new Request("https://events.imsda.test/x?view=list"), ctx())).text());
      expect(list.find((row) => row[1] === "Archery")).toEqual(["Honors", "Archery", "", "", "5", "0", "", "5"]);
      const all = parseCsvMatrix(await (await GET_CSV(new Request("https://events.imsda.test/x?view=all"), ctx())).text());
      expect(all.find((row) => row[1] === "Archery")).toEqual(["Honors", "Archery", "", "", "5", "", "5"]);
    });
  });

  it("refuses the retired AdventSource and readable exports, and an unknown view, with 400", async () => {
    for (const view of ["adventsource", "readable", "nonsense"]) {
      expect((await GET_CSV(new Request(`https://events.imsda.test/x?view=${view}`), ctx())).status).toBe(400);
    }
    expect(mocks.listHelperLines).not.toHaveBeenCalled();
  });

  it("rejects an empty award list", async () => {
    const response = await POST_AWARD(postRequest({ needIds: [] }), ctx());
    expect(response.status).toBe(400);
    expect(mocks.markNeedsAwarded).not.toHaveBeenCalled();
  });
});
