import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  getCurrentSession: vi.fn(),
  rejectCrossOrigin: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: mocks.rejectCrossOrigin }));

import { GET, PATCH } from "@/app/api/admin/platform-settings/homepage-ministries/route";
import { getHomepageMinistriesForAdmin, listHomepageMinistries, updateHomepageMinistries } from "@/modules/system-admin/homepage-ministries";
import {
  fallbackHomepageMinistries,
  homepageMinistriesInputSchema,
  isValidMinistryLink,
} from "@/modules/system-admin/homepage-ministries-domain";

const tile = (position: number, overrides: Record<string, unknown> = {}) => ({
  position,
  name: `Synthetic ministry ${position}`,
  description: "",
  linkHref: "",
  categories: ["Youth"],
  icon: "Users",
  ...overrides,
});
const sixTiles = (overrides: Record<string, unknown> = {}) => ({ ministries: [1, 2, 3, 4, 5, 6].map((position) => tile(position, overrides)) });

describe("homepage ministries input (#1251)", () => {
  it("accepts six tiles, storing blank description and link as null and trimming and de-duplicating categories", () => {
    const parsed = homepageMinistriesInputSchema.parse(sixTiles({ categories: [" Youth ", "youth", "Camp Meeting"] }));
    expect(parsed.ministries[0]).toMatchObject({ description: null, linkHref: null, categories: ["Youth", "Camp Meeting"] });
  });

  it("limits a description to 200 plain-text characters on one line", () => {
    expect(homepageMinistriesInputSchema.safeParse(sixTiles({ description: "a".repeat(200) })).success).toBe(true);
    expect(homepageMinistriesInputSchema.safeParse(sixTiles({ description: "a".repeat(201) })).success).toBe(false);
    expect(homepageMinistriesInputSchema.safeParse(sixTiles({ description: "<b>Hi</b>" })).success).toBe(false);
    expect(homepageMinistriesInputSchema.safeParse(sixTiles({ description: "one\ntwo" })).success).toBe(false);
  });

  it("takes only a site path or an https link", () => {
    for (const good of ["/calendar?view=list", "/clubs", "https://example.test/page"]) expect(isValidMinistryLink(good)).toBe(true);
    for (const bad of ["//example.test", "http://example.test", "javascript:alert(1)", "example.test", "/a b", "/\\evil", "mailto:a@example.test"]) expect(isValidMinistryLink(bad)).toBe(false);
    expect(homepageMinistriesInputSchema.safeParse(sixTiles({ linkHref: "//example.test" })).success).toBe(false);
  });

  it("takes only the fixed icons, exactly six tiles with their own positions, and no unknown fields", () => {
    expect(homepageMinistriesInputSchema.safeParse(sixTiles({ icon: "Skull" })).success).toBe(false);
    expect(homepageMinistriesInputSchema.safeParse({ ministries: sixTiles().ministries.slice(0, 5) }).success).toBe(false);
    expect(homepageMinistriesInputSchema.safeParse({ ministries: [...sixTiles().ministries.slice(0, 5), tile(5)] }).success).toBe(false);
    expect(homepageMinistriesInputSchema.safeParse(sixTiles({ name: "  " })).success).toBe(false);
    expect(homepageMinistriesInputSchema.safeParse(sixTiles({ extra: 1 })).success).toBe(false);
  });
});

describe("reading the tiles (#1251)", () => {
  it("falls back to the six names with no categories when the table is empty or unreadable", async () => {
    mocks.getPrisma.mockReturnValue({ homepageMinistry: { findMany: vi.fn().mockResolvedValue([]) } });
    expect(await listHomepageMinistries()).toEqual(fallbackHomepageMinistries);
    mocks.getPrisma.mockReturnValue({ homepageMinistry: { findMany: vi.fn().mockRejectedValue(new Error("down")) } });
    expect(await listHomepageMinistries()).toEqual(fallbackHomepageMinistries);
    expect(fallbackHomepageMinistries.every((entry) => entry.categories.length === 0)).toBe(true);
  });

  it("returns stored tiles with blank descriptions as null and an unknown icon as the default", async () => {
    mocks.getPrisma.mockReturnValue({
      homepageMinistry: { findMany: vi.fn().mockResolvedValue([{ position: 1, name: "Youth", description: "  ", linkHref: "", categories: ["Youth"], icon: "Retired" }]) },
    });
    expect(await listHomepageMinistries()).toEqual([{ position: 1, name: "Youth", description: null, linkHref: null, categories: ["Youth"], icon: "Users" }]);
  });

  it("gives the admin form a slot for every position even when some rows are missing", async () => {
    mocks.getPrisma.mockReturnValue({
      homepageMinistry: { findMany: vi.fn().mockResolvedValue([{ position: 2, name: "Edited", description: null, linkHref: null, categories: [], icon: "Star", updatedAt: new Date("2026-10-27T12:00:00Z"), updatedBy: { displayName: "Synthetic Admin" } }]) },
    });
    const result = await getHomepageMinistriesForAdmin();
    expect(result.ministries.map((entry) => entry.name)).toEqual(["Pathfinders", "Edited", "Women's Ministries", "Men's Ministries", "Camp Meeting", "Youth"]);
    expect(result).toMatchObject({ updatedAt: "2026-10-27T12:00:00.000Z", updatedByName: "Synthetic Admin" });
  });
});

describe("saving the tiles (#1251)", () => {
  it("writes every tile and one audit row with both sides, in one transaction", async () => {
    const upsert = vi.fn();
    const auditCreate = vi.fn();
    const stored = [{ position: 1, name: "Pathfinders", description: null, linkHref: null, categories: ["Pathfinders"], icon: "Compass" }];
    const tx = { homepageMinistry: { findMany: vi.fn().mockResolvedValue(stored), upsert }, auditLog: { create: auditCreate } };
    mocks.getPrisma.mockReturnValue({
      $transaction: vi.fn(async (work: (client: unknown) => unknown) => work(tx)),
      homepageMinistry: { findMany: vi.fn().mockResolvedValue([]) },
    });
    const input = homepageMinistriesInputSchema.parse(sixTiles({ description: "Synthetic line." }));
    await updateHomepageMinistries(input, "admin-1");
    expect(upsert).toHaveBeenCalledTimes(6);
    expect(upsert.mock.calls[0][0]).toMatchObject({
      where: { position: 1 },
      update: { name: "Synthetic ministry 1", description: "Synthetic line.", linkHref: null, categories: ["Youth"], icon: "Users", updatedByUserId: "admin-1" },
    });
    expect(auditCreate).toHaveBeenCalledTimes(1);
    const audit = auditCreate.mock.calls[0][0].data;
    expect(audit).toMatchObject({ actorUserId: "admin-1", action: "HOMEPAGE_MINISTRIES_UPDATED", entityType: "HomepageMinistry" });
    expect(audit.metadata.before).toEqual([{ position: 1, name: "Pathfinders", description: null, linkHref: null, categories: ["Pathfinders"], icon: "Compass" }]);
    expect(audit.metadata.after).toHaveLength(6);
    expect(audit.metadata.after[0]).toMatchObject({ position: 1, name: "Synthetic ministry 1", description: "Synthetic line." });
  });
});

describe("the homepage ministries route (#1251)", () => {
  const request = (body: unknown) => new Request("https://events.example.test/api/admin/platform-settings/homepage-ministries", { method: "PATCH", body: JSON.stringify(body) });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rejectCrossOrigin.mockReturnValue(null);
  });

  it("is for system administrators only: signed out, plain staff and event admins get 403 and nothing is written", async () => {
    const write = vi.fn();
    mocks.getPrisma.mockReturnValue({ $transaction: write, homepageMinistry: { findMany: vi.fn().mockResolvedValue([]) } });
    for (const user of [null, { id: "u", globalRole: "STAFF" }, { id: "u", globalRole: "CLUBS_ADMINISTRATOR" }]) {
      mocks.getCurrentSession.mockResolvedValue({ user });
      expect((await PATCH(request(sixTiles()))).status).toBe(403);
      expect((await GET(request({}))).status).toBe(403);
    }
    expect(write).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin request before anything else", async () => {
    mocks.rejectCrossOrigin.mockReturnValue(Response.json({ error: "CROSS_ORIGIN" }, { status: 403 }));
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "admin-1", globalRole: "SYSTEM_ADMIN" } });
    const response = await PATCH(request(sixTiles()));
    expect(response.status).toBe(403);
    expect(mocks.getCurrentSession).not.toHaveBeenCalled();
  });

  it("rejects invalid tiles with 400 and saves valid ones for a system administrator", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "admin-1", globalRole: "SYSTEM_ADMIN" } });
    const upsert = vi.fn();
    const tx = { homepageMinistry: { findMany: vi.fn().mockResolvedValue([]), upsert }, auditLog: { create: vi.fn() } };
    mocks.getPrisma.mockReturnValue({
      $transaction: vi.fn(async (work: (client: unknown) => unknown) => work(tx)),
      homepageMinistry: { findMany: vi.fn().mockResolvedValue([]) },
    });
    const bad = await PATCH(request(sixTiles({ linkHref: "http://example.test" })));
    expect(bad.status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
    const good = await PATCH(request(sixTiles()));
    expect(good.status).toBe(200);
    expect(upsert).toHaveBeenCalledTimes(6);
  });
});
