import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventPermission } from "@/modules/access/permissions";
import { emptySearchCatalog } from "@/modules/registrations/operations-search-domain";

// #1511: saved views, owner-only for unshared ones, share needs MANAGE_REGISTRATION, the audit says keys not values.
// An in-memory stand-in for the one table. Synthetic data only.
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ getPrisma: vi.fn(), writeAuditLog: vi.fn(), loadCatalog: vi.fn(), isClubEvent: vi.fn() }));
vi.mock("@/modules/access/club-event-access", () => ({ isClubEvent: mocks.isClubEvent }));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/registrations/operations-search-repository", () => ({ loadOperationsSearchCatalog: mocks.loadCatalog }));

import { AccessDeniedError } from "@/modules/access/authorization";
import {
  SavedViewError,
  createSavedView,
  restoreSavedView,
  deleteSavedView,
  listSavedViews,
  setSavedViewShared,
} from "@/modules/registrations/saved-views-repository";

type Row = { id: string; eventId: string; ownerUserId: string; name: string; query: string; shared: boolean; sharedAt: Date | null; sharedByUserId: string | null; owner: { displayName: string; globalRole?: "SYSTEM_ADMIN" | null } };
let rows: Row[] = [];
let counter = 0;
let gone = new Set<string>();
let inactive = new Set<string>();
let grants = new Set<string>();

function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR") return (value as Record<string, unknown>[]).some((branch) => matches(row, branch));
    if (value && typeof value === "object" && "not" in value) return row[key as keyof Row] !== (value as { not: unknown }).not;
    if (value && typeof value === "object" && "equals" in value) return String(row[key as keyof Row]).toLowerCase() === String((value as { equals: string }).equals).toLowerCase();
    return row[key as keyof Row] === value;
  });
}

function installPrisma() {
  const registrationSavedView = {
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => rows.filter((row) => matches(row, where))),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => rows.find((row) => matches(row, where)) ?? null),
    create: vi.fn(async ({ data }: { data: Partial<Row> & { eventId: string; ownerUserId: string; name: string; query: string } }) => {
      const row: Row = { id: `view-${++counter}`, shared: false, sharedAt: null, sharedByUserId: null, owner: { displayName: "Owner" }, ...data };
      rows.push(row);
      return row;
    }),
    count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => rows.filter((row) => matches(row, where)).length),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<Row> }) => {
      const hit = rows.filter((row) => matches(row, where));
      hit.forEach((row) => Object.assign(row, data));
      return { count: hit.length };
    }),
    deleteMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const hit = rows.filter((row) => matches(row, where));
      rows = rows.filter((row) => !hit.includes(row));
      return { count: hit.length };
    }),
  };
  // Everyone has an ACTIVE membership unless a test says they left or only hold an INACTIVE one.
  const eventMembership = {
    findMany: vi.fn(async ({ where }: { where: { userId: { in: string[] }; status: string } }) => where.userId.in.filter((id) => !gone.has(id) && !inactive.has(id)).map((userId) => ({ userId }))),
  };
  const clubsAdministratorGrant = { findMany: vi.fn(async ({ where }: { where: { userId: { in: string[] } } }) => where.userId.in.filter((id) => grants.has(id)).map((userId) => ({ userId }))) };
  mocks.getPrisma.mockReturnValue({ registrationSavedView, eventMembership, clubsAdministratorGrant });
  return registrationSavedView;
}

const reader: EventPermission[] = ["VIEW_EVENT", "VIEW_SENSITIVE_DATA"];
const manager: EventPermission[] = ["VIEW_EVENT", "VIEW_SENSITIVE_DATA", "MANAGE_REGISTRATION"];
const viewerFor = (userId: string, permissions: EventPermission[], eventId = "event-1") => ({ eventId, userId, permissions });
const seed = (extra: Partial<Row>): Row => {
  const row: Row = { id: `seed-${++counter}`, eventId: "event-1", ownerUserId: "user-a", name: "Seed", query: "status=CONFIRMED", shared: false, sharedAt: null, sharedByUserId: null, owner: { displayName: "Alex Sample" }, ...extra };
  rows.push(row);
  return row;
};

beforeEach(() => {
  rows = [];
  counter = 0;
  vi.clearAllMocks();
  installPrisma();
  // Everyone is on the event's staff unless a test says they left.
  gone = new Set();
  inactive = new Set();
  grants = new Set();
  mocks.isClubEvent.mockResolvedValue(false);
  mocks.loadCatalog.mockResolvedValue({ ...emptySearchCatalog(), tags: [{ id: "tag-1", name: "VIP", isActive: true }] });
});

describe("saving a view", () => {
  it("stores the canonical query without its page and audits the filter keys only", async () => {
    const saved = await createSavedView(viewerFor("user-a", reader), { name: "  Unpaid   VIP ", query: "page=3&tag=tag-1&q=pat+example" });
    expect(saved.query).toBe("q=pat+example&tag=tag-1");
    expect(rows[0]).toMatchObject({ name: "Unpaid VIP", shared: false, ownerUserId: "user-a", eventId: "event-1" });
    const entry = mocks.writeAuditLog.mock.calls[0]![0];
    expect(entry).toMatchObject({ eventId: "event-1", entityType: "RegistrationSavedView", action: "REGISTRATION_SAVED_VIEW_SAVED" });
    expect(entry.metadata).toEqual({ savedViewId: saved.id, shared: false, filterKeys: ["q", "tag"] });
    expect(JSON.stringify(entry)).not.toContain("pat");
    expect(JSON.stringify(entry)).not.toContain("tag-1");
  });

  it("refuses a filter the saver cannot use, and stores nothing", async () => {
    await expect(createSavedView(viewerFor("user-a", reader), { name: "Money", query: "payment=PAID" })).rejects.toMatchObject({ code: "INVALID" });
    await expect(createSavedView(viewerFor("user-a", reader), { name: "Gone", query: "tag=tag-gone" })).rejects.toMatchObject({ code: "INVALID" });
    expect(rows).toHaveLength(0);
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("refuses no filters, a blank name and a taken name", async () => {
    await expect(createSavedView(viewerFor("user-a", reader), { name: "Empty", query: "page=2" })).rejects.toMatchObject({ code: "INVALID" });
    await expect(createSavedView(viewerFor("user-a", reader), { name: "  ", query: "status=CONFIRMED" })).rejects.toMatchObject({ code: "INVALID" });
    await createSavedView(viewerFor("user-a", reader), { name: "Mine", query: "status=CONFIRMED" });
    await expect(createSavedView(viewerFor("user-a", reader), { name: "mine", query: "status=DRAFT" })).rejects.toMatchObject({ code: "NAME_TAKEN" });
    // Another person may use the same name.
    await expect(createSavedView(viewerFor("user-b", reader), { name: "Mine", query: "status=DRAFT" })).resolves.toBeTruthy();
  });

  it("refuses a value the page would have rejected, so nothing is stored without it", async () => {
    await expect(createSavedView(viewerFor("user-a", reader), { name: "Odd", query: "status=PENDING_APPROVAL&sort=name" })).rejects.toMatchObject({ code: "INVALID" });
    expect(rows).toHaveLength(0);
  });

  it("keeps at most 50 views per person per event", async () => {
    for (let index = 0; index < 50; index += 1) seed({ ownerUserId: "user-a", name: `View ${index}` });
    await expect(createSavedView(viewerFor("user-a", reader), { name: "One more", query: "status=CONFIRMED" })).rejects.toMatchObject({ code: "LIMIT_REACHED" });
    await expect(createSavedView(viewerFor("user-b", reader), { name: "Fine", query: "status=CONFIRMED" })).resolves.toBeTruthy();
  });

  it("maps a database unique violation to a taken name", async () => {
    const prisma = installPrisma();
    prisma.create.mockRejectedValueOnce(Object.assign(new Error("unique"), { code: "P2002" }));
    await expect(createSavedView(viewerFor("user-a", reader), { name: "Race", query: "status=CONFIRMED" })).rejects.toMatchObject({ code: "NAME_TAKEN" });
  });

  it("needs the list permission, and sharing at save needs MANAGE_REGISTRATION", async () => {
    await expect(createSavedView(viewerFor("user-a", ["VIEW_EVENT"]), { name: "No", query: "status=CONFIRMED" })).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(createSavedView(viewerFor("user-a", reader), { name: "Share", query: "status=CONFIRMED", shared: true })).rejects.toBeInstanceOf(AccessDeniedError);
    expect(rows).toHaveLength(0);
    await createSavedView(viewerFor("user-a", manager), { name: "Share", query: "status=CONFIRMED", shared: true });
    expect(rows[0]).toMatchObject({ shared: true, sharedByUserId: "user-a" });
    expect(mocks.writeAuditLog.mock.calls.map((call) => call[0].action)).toEqual(["REGISTRATION_SAVED_VIEW_SAVED", "REGISTRATION_SAVED_VIEW_SHARED"]);
  });
});

describe("listing views", () => {
  it("shows own views and others' shared views, never another person's unshared view, and flags stale ones", async () => {
    seed({ id: "own", name: "Own", ownerUserId: "user-b", query: "status=CONFIRMED" });
    seed({ id: "theirs-shared", name: "Shared", shared: true, query: "tag=tag-gone" });
    seed({ id: "theirs-private", name: "Private" });
    seed({ id: "other-event", eventId: "event-2", ownerUserId: "user-b", name: "Elsewhere" });
    const catalog = { ...emptySearchCatalog(), tags: [{ id: "tag-1", name: "VIP", isActive: true }] };
    const { views } = await listSavedViews(viewerFor("user-b", reader), catalog);
    expect(views.map((view) => view.id).sort()).toEqual(["own", "theirs-shared"]);
    expect(views.find((view) => view.id === "own")).toMatchObject({ isOwn: true, ownerName: null, stale: false });
    expect(views.find((view) => view.id === "theirs-shared")).toMatchObject({ isOwn: false, ownerName: "Alex Sample", stale: true });
  });

  it("flags a shared view that uses a domain this viewer lacks", async () => {
    seed({ id: "money", shared: true, query: "payment=PAID" });
    const catalog = emptySearchCatalog();
    const [view] = (await listSavedViews(viewerFor("user-b", reader), catalog)).views;
    expect(view?.stale).toBe(true);
  });
});

describe("sharing", () => {
  it("lets the owner with MANAGE_REGISTRATION share and stop sharing, auditing each", async () => {
    seed({ id: "v1", ownerUserId: "user-a", query: "tag=tag-1" });
    await setSavedViewShared(viewerFor("user-a", manager), "v1", true);
    expect(rows[0]).toMatchObject({ shared: true, sharedByUserId: "user-a" });
    await setSavedViewShared(viewerFor("user-a", manager), "v1", false);
    expect(rows[0]).toMatchObject({ shared: false, sharedAt: null, sharedByUserId: null });
    const calls = mocks.writeAuditLog.mock.calls.map((call) => call[0]);
    expect(calls.map((call) => call.action)).toEqual(["REGISTRATION_SAVED_VIEW_SHARED", "REGISTRATION_SAVED_VIEW_UNSHARED"]);
    expect(calls[0].metadata).toEqual({ savedViewId: "v1", shared: true, filterKeys: ["tag"] });
  });

  it("lets an owner without MANAGE_REGISTRATION stop sharing, but not start", async () => {
    seed({ id: "v1", ownerUserId: "user-a", shared: true, sharedAt: new Date(), sharedByUserId: "user-a" });
    await setSavedViewShared(viewerFor("user-a", reader), "v1", false);
    expect(rows[0]?.shared).toBe(false);
    await expect(setSavedViewShared(viewerFor("user-a", reader), "v1", true)).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("needs MANAGE_REGISTRATION", async () => {
    seed({ id: "v1", ownerUserId: "user-a" });
    await expect(setSavedViewShared(viewerFor("user-a", reader), "v1", true)).rejects.toBeInstanceOf(AccessDeniedError);
    expect(rows[0]?.shared).toBe(false);
  });

  it("is owner-only: another person's unshared view is not found, and their shared view is refused", async () => {
    seed({ id: "private", ownerUserId: "user-a" });
    seed({ id: "public", ownerUserId: "user-a", shared: true });
    await expect(setSavedViewShared(viewerFor("user-b", manager), "private", true)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(setSavedViewShared(viewerFor("user-b", manager), "public", false)).rejects.toBeInstanceOf(AccessDeniedError);
    expect(rows.find((row) => row.id === "public")?.shared).toBe(true);
    expect(rows.find((row) => row.id === "private")?.shared).toBe(false);
  });

  it("will not publish a view that has gone stale", async () => {
    seed({ id: "old", ownerUserId: "user-a", query: "tag=tag-gone" });
    await expect(setSavedViewShared(viewerFor("user-a", manager), "old", true)).rejects.toMatchObject({ code: "INVALID" });
    expect(rows[0]?.shared).toBe(false);
  });
});

describe("deleting", () => {
  it("lets the owner delete their own view, shared or not", async () => {
    seed({ id: "mine", ownerUserId: "user-a" });
    await deleteSavedView(viewerFor("user-a", reader), "mine");
    expect(rows).toHaveLength(0);
    expect(mocks.writeAuditLog.mock.calls[0]![0]).toMatchObject({ action: "REGISTRATION_SAVED_VIEW_DELETED", entityId: "mine" });
    expect(mocks.writeAuditLog.mock.calls[0]![0].metadata).toEqual({ savedViewId: "mine", shared: false, removedByOwner: true, filterKeys: ["status"] });
  });

  it("lets a MANAGE_REGISTRATION holder delete another person's shared view, but not an unshared one", async () => {
    seed({ id: "public", ownerUserId: "user-a", shared: true });
    seed({ id: "private", ownerUserId: "user-a" });
    await expect(deleteSavedView(viewerFor("user-b", manager), "private")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(rows.map((row) => row.id)).toContain("private");
    await deleteSavedView(viewerFor("user-b", manager), "public");
    expect(rows.map((row) => row.id)).toEqual(["private"]);
  });

  it("refuses a reader deleting someone else's shared view", async () => {
    seed({ id: "public", ownerUserId: "user-a", shared: true });
    await expect(deleteSavedView(viewerFor("user-b", reader), "public")).rejects.toBeInstanceOf(AccessDeniedError);
    expect(rows).toHaveLength(1);
  });

  it("does not find a view of another event", async () => {
    seed({ id: "elsewhere", eventId: "event-2", ownerUserId: "user-a", shared: true });
    await expect(deleteSavedView(viewerFor("user-a", manager, "event-1"), "elsewhere")).rejects.toBeInstanceOf(SavedViewError);
    await expect(setSavedViewShared(viewerFor("user-a", manager, "event-1"), "elsewhere", false)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(rows).toHaveLength(1);
  });
});

describe("a deactivated tag counts as gone (Caleb, #1511)", () => {
  const withInactive = () => mocks.loadCatalog.mockResolvedValue({ ...emptySearchCatalog(), tags: [{ id: "tag-1", name: "VIP", isActive: true }, { id: "tag-off", name: "Old", isActive: false }] });

  it("flags a view with a deactivated tag stale in the list", async () => {
    seed({ id: "off", shared: true, query: "tag=tag-off" });
    const catalog = { ...emptySearchCatalog(), tags: [{ id: "tag-off", name: "Old", isActive: false }] };
    expect((await listSavedViews(viewerFor("user-b", reader), catalog)).views[0]?.stale).toBe(true);
  });

  it("refuses saving, and turning sharing on, with a deactivated tag", async () => {
    withInactive();
    await expect(createSavedView(viewerFor("user-a", reader), { name: "Old", query: "tag=tag-off" })).rejects.toMatchObject({ code: "INVALID" });
    expect(rows).toHaveLength(0);
    seed({ id: "v1", ownerUserId: "user-a", query: "tag=tag-off" });
    await expect(setSavedViewShared(viewerFor("user-a", manager), "v1", true)).rejects.toMatchObject({ code: "INVALID" });
    await expect(createSavedView(viewerFor("user-a", reader), { name: "Active", query: "tag=tag-1" })).resolves.toBeTruthy();
  });
});

describe("archived views (shared by staff who left)", () => {
  const catalog = () => ({ ...emptySearchCatalog(), tags: [{ id: "tag-1", name: "VIP", isActive: true }] });

  it("hides them from a reader, lists them as archived for a manager, never lists unshared ones", async () => {
    gone = new Set(["user-gone"]);
    seed({ id: "arch", ownerUserId: "user-gone", shared: true, name: "Archived one" });
    seed({ id: "arch-private", ownerUserId: "user-gone", name: "Private" });
    seed({ id: "live", ownerUserId: "user-a", shared: true, name: "Live" });
    const reading = await listSavedViews(viewerFor("user-b", reader), catalog());
    expect(reading.views.map((view) => view.id)).toEqual(["live"]);
    expect(reading.archived).toEqual([]);
    const managing = await listSavedViews(viewerFor("user-b", manager), catalog());
    expect(managing.views.map((view) => view.id)).toEqual(["live"]);
    expect(managing.archived.map((view) => view.id)).toEqual(["arch"]);
  });

  it("does not archive a system administrator's view, or a current member's", async () => {
    gone = new Set(["admin-1"]);
    seed({ id: "admin", ownerUserId: "admin-1", shared: true, owner: { displayName: "Admin", globalRole: "SYSTEM_ADMIN" } });
    const result = await listSavedViews(viewerFor("user-b", manager), catalog());
    expect(result.views.map((view) => view.id)).toEqual(["admin"]);
    expect(result.archived).toEqual([]);
  });

  it("restores for a manager: the restorer owns it, it stays shared, and the audit has ids and keys only", async () => {
    gone = new Set(["user-gone"]);
    seed({ id: "arch", ownerUserId: "user-gone", shared: true, name: "Private Name", query: "tag=tag-1" });
    await restoreSavedView(viewerFor("user-b", manager), "arch");
    expect(rows[0]).toMatchObject({ ownerUserId: "user-b", shared: true, sharedByUserId: "user-b" });
    const entry = mocks.writeAuditLog.mock.calls[0]![0];
    expect(entry).toMatchObject({ action: "REGISTRATION_SAVED_VIEW_RESTORED", entityId: "arch" });
    expect(entry.metadata).toEqual({ savedViewId: "arch", previousOwnerUserId: "user-gone", filterKeys: ["tag"] });
    expect(JSON.stringify(entry)).not.toContain("Private Name");
    expect(JSON.stringify(entry)).not.toContain("tag-1");
  });

  it("refuses a non-manager, a view whose owner is still on staff, an unshared view and another event's view", async () => {
    gone = new Set(["user-gone"]);
    seed({ id: "arch", ownerUserId: "user-gone", shared: true });
    seed({ id: "live", ownerUserId: "user-a", shared: true });
    seed({ id: "private", ownerUserId: "user-gone" });
    seed({ id: "elsewhere", eventId: "event-2", ownerUserId: "user-gone", shared: true });
    await expect(restoreSavedView(viewerFor("user-b", reader), "arch")).rejects.toBeInstanceOf(AccessDeniedError);
    for (const id of ["live", "private", "elsewhere"]) await expect(restoreSavedView(viewerFor("user-b", manager), id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(rows.find((row) => row.id === "arch")?.ownerUserId).toBe("user-gone");
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("answers a name clash and the 50-view limit as refusals, and re-checks the filters for the restorer", async () => {
    gone = new Set(["user-gone"]);
    seed({ id: "arch", ownerUserId: "user-gone", shared: true, name: "Same" });
    seed({ ownerUserId: "user-b", name: "same" });
    await expect(restoreSavedView(viewerFor("user-b", manager), "arch")).rejects.toMatchObject({ code: "NAME_TAKEN" });
    rows = rows.filter((row) => row.ownerUserId !== "user-b");
    for (let index = 0; index < 50; index += 1) seed({ ownerUserId: "user-b", name: `View ${index}` });
    await expect(restoreSavedView(viewerFor("user-b", manager), "arch")).rejects.toMatchObject({ code: "LIMIT_REACHED" });
    rows = rows.filter((row) => row.ownerUserId !== "user-b");
    rows.find((row) => row.id === "arch")!.query = "tag=tag-gone";
    await expect(restoreSavedView(viewerFor("user-b", manager), "arch")).rejects.toMatchObject({ code: "INVALID" });
  });

  it("counts an INACTIVE membership as left", async () => {
    inactive = new Set(["user-off"]);
    seed({ id: "off", ownerUserId: "user-off", shared: true });
    const result = await listSavedViews(viewerFor("user-b", manager), catalog());
    expect(result.views).toEqual([]);
    expect(result.archived.map((view) => view.id)).toEqual(["off"]);
  });

  it("keeps a Clubs Administrator without a membership on staff for a club event only", async () => {
    gone = new Set(["clubs-admin"]);
    grants = new Set(["clubs-admin"]);
    seed({ id: "clubs", ownerUserId: "clubs-admin", shared: true });
    expect((await listSavedViews(viewerFor("user-b", manager), catalog())).archived.map((view) => view.id)).toEqual(["clubs"]);
    mocks.isClubEvent.mockResolvedValue(true);
    const result = await listSavedViews(viewerFor("user-b", manager), catalog());
    expect(result.views.map((view) => view.id)).toEqual(["clubs"]);
    expect(result.archived).toEqual([]);
  });

  it("reads memberships for all owners in one query", async () => {
    gone = new Set(["g1", "g2"]);
    seed({ ownerUserId: "g1", shared: true, name: "One" });
    seed({ ownerUserId: "g2", shared: true, name: "Two" });
    seed({ ownerUserId: "user-a", shared: true, name: "Three" });
    await listSavedViews(viewerFor("user-b", manager), catalog());
    expect(mocks.getPrisma().eventMembership.findMany).toHaveBeenCalledTimes(1);
  });

  it("answers not found when the restore finds the view already taken over", async () => {
    gone = new Set(["user-gone"]);
    seed({ id: "arch", ownerUserId: "user-gone", shared: true });
    const table = mocks.getPrisma().registrationSavedView;
    table.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(restoreSavedView(viewerFor("user-b", manager), "arch")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("lets a manager delete an archived view", async () => {
    gone = new Set(["user-gone"]);
    seed({ id: "arch", ownerUserId: "user-gone", shared: true });
    await deleteSavedView(viewerFor("user-b", manager), "arch");
    expect(rows).toHaveLength(0);
    expect(mocks.writeAuditLog.mock.calls[0]![0].action).toBe("REGISTRATION_SAVED_VIEW_DELETED");
  });
});
