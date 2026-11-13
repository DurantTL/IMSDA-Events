import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), listPermissions: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({ eventMembership: { findMany: mocks.findMany } }) }));
vi.mock("@/modules/access/membership-repository", () => ({ listActiveEventPermissionsForUser: mocks.listPermissions }));

import { canViewProfilePhoto } from "@/modules/profile-photos/viewing";

beforeEach(() => vi.clearAllMocks());

describe("who may view a staff photo (#1640)", () => {
  it("lets a person see their own photo without any lookup", async () => {
    expect(await canViewProfilePhoto({ id: "u1" }, "u1")).toBe(true);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("lets a system administrator see any photo", async () => {
    expect(await canViewProfilePhoto({ id: "admin", globalRole: "SYSTEM_ADMIN" }, "u1")).toBe(true);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("lets a staff manager see someone on an event they manage, in two bounded queries", async () => {
    mocks.findMany.mockResolvedValue([{ eventId: "e1" }, { eventId: "e2" }]);
    mocks.listPermissions.mockResolvedValue(new Map([["e2", ["MANAGE_STAFF", "VIEW_REGISTRATIONS"]]]));
    expect(await canViewProfilePhoto({ id: "mgr" }, "u1")).toBe(true);
    expect(mocks.findMany).toHaveBeenCalledTimes(1);
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "u1" }, take: expect.any(Number) }));
    expect(mocks.listPermissions).toHaveBeenCalledWith("mgr", ["e1", "e2"]);
  });

  it("refuses staff who hold other permissions but not MANAGE_STAFF", async () => {
    mocks.findMany.mockResolvedValue([{ eventId: "e1" }]);
    mocks.listPermissions.mockResolvedValue(new Map([["e1", ["VIEW_REGISTRATIONS", "CHECK_IN"]]]));
    expect(await canViewProfilePhoto({ id: "checkin" }, "u1")).toBe(false);
  });

  it("refuses a manager of events the person is not on", async () => {
    mocks.findMany.mockResolvedValue([{ eventId: "e1" }]);
    mocks.listPermissions.mockResolvedValue(new Map());
    expect(await canViewProfilePhoto({ id: "mgr" }, "u1")).toBe(false);
  });

  it("refuses when the person is on no event at all", async () => {
    mocks.findMany.mockResolvedValue([]);
    expect(await canViewProfilePhoto({ id: "mgr" }, "u1")).toBe(false);
    expect(mocks.listPermissions).not.toHaveBeenCalled();
  });
});
