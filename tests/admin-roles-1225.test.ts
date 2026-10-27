import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #1225: the admin roles a staff account holds and the role switcher. The roles are read from the database on every
 * call (a revoke applies at once), and the switcher's cookie is only a view preference: a value for a role that is not
 * held is ignored. Synthetic data only.
 */

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  grantFindFirst: vi.fn(),
  membershipFindMany: vi.fn(),
  cookieValue: undefined as string | undefined,
  cookieSet: vi.fn(),
  getCurrentSession: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    clubsAdministratorGrant: { findFirst: mocks.grantFindFirst },
    eventMembership: { findMany: mocks.membershipFindMany },
  }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "imsda_admin_role" && mocks.cookieValue ? { name, value: mocks.cookieValue } : undefined),
    set: mocks.cookieSet,
  }),
}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/modules/access/request-security", () => ({
  rejectCrossOriginRequest: (request: Request) => (request.headers.get("origin") === "https://events.imsda.test" ? null : Response.json({ error: "INVALID_REQUEST_ORIGIN" }, { status: 403 })),
}));

import {
  ADMIN_ROLE_LABELS,
  adminRoleLanding,
  adminRoleSidebarKind,
  adminRoleSwitchNote,
  heldAdminRoles,
  resolveActiveAdminRole,
} from "@/modules/access/admin-roles-domain";
import { isActiveClubsAdministrator, resolveAdminRoleView, resolveAdminRoles } from "@/modules/access/admin-roles";
import { POST as switchRole } from "@/app/api/staff/admin-role/route";
import { GET as switchRoleLink } from "@/app/(workspace)/admin-role/[role]/route";

const none = { systemAdmin: false, clubsAdministrator: false, eventAdminEventIds: [] as string[] };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cookieValue = undefined;
  mocks.grantFindFirst.mockResolvedValue(null);
  mocks.membershipFindMany.mockResolvedValue([]);
});

describe("roles held (pure)", () => {
  it("lists only the roles held, in switcher order", () => {
    expect(heldAdminRoles(none)).toEqual([]);
    expect(heldAdminRoles({ ...none, eventAdminEventIds: ["e1"] })).toEqual(["EVENTS_ADMIN"]);
    expect(heldAdminRoles({ systemAdmin: true, clubsAdministrator: true, eventAdminEventIds: ["e1", "e2"] })).toEqual(["EVENTS_ADMIN", "CLUBS_ADMIN", "SYSTEM_ADMIN"]);
    expect(heldAdminRoles({ ...none, clubsAdministrator: true })).toEqual(["CLUBS_ADMIN"]);
  });

  it("names the roles the way the pills do", () => {
    expect(Object.values(ADMIN_ROLE_LABELS)).toEqual(["Events Administrator", "Clubs Administrator", "System Administrator"]);
  });

  it("says how many roles are held only when there is a choice", () => {
    expect(adminRoleSwitchNote(["CLUBS_ADMIN"])).toBeNull();
    expect(adminRoleSwitchNote(["EVENTS_ADMIN", "CLUBS_ADMIN"])).toBe("You hold 2 admin roles. Switch between them any time.");
    expect(adminRoleSwitchNote(["EVENTS_ADMIN", "CLUBS_ADMIN", "SYSTEM_ADMIN"])).toBe("You hold 3 admin roles. Switch between them any time.");
  });
});

describe("the role showing (cookie fallback)", () => {
  const all = ["EVENTS_ADMIN", "CLUBS_ADMIN", "SYSTEM_ADMIN"] as const;

  it("uses the cookie's role when it is still held", () => {
    expect(resolveActiveAdminRole(all, "EVENTS_ADMIN")).toBe("EVENTS_ADMIN");
    expect(resolveActiveAdminRole(["EVENTS_ADMIN", "CLUBS_ADMIN"], "CLUBS_ADMIN")).toBe("CLUBS_ADMIN");
  });

  it("falls back to the broadest role held when the cookie names a role that is not held, or garbage", () => {
    expect(resolveActiveAdminRole(["EVENTS_ADMIN"], "SYSTEM_ADMIN")).toBe("EVENTS_ADMIN");
    expect(resolveActiveAdminRole(["EVENTS_ADMIN", "CLUBS_ADMIN"], "SYSTEM_ADMIN")).toBe("CLUBS_ADMIN");
    expect(resolveActiveAdminRole(all, "nope")).toBe("SYSTEM_ADMIN");
    expect(resolveActiveAdminRole(all, undefined)).toBe("SYSTEM_ADMIN");
    expect(resolveActiveAdminRole([], "SYSTEM_ADMIN")).toBeNull();
  });

  it("lands each role on its own home and picks its sidebar", () => {
    expect(adminRoleLanding("CLUBS_ADMIN")).toBe("/admin/clubs");
    expect(adminRoleLanding("SYSTEM_ADMIN")).toBe("/admin");
    expect(adminRoleLanding("EVENTS_ADMIN")).toBe("/events-admin");
    expect(adminRoleLanding(null)).toBe("/overview");
    expect(adminRoleSidebarKind("CLUBS_ADMIN")).toBe("clubs");
    expect(adminRoleSidebarKind("EVENTS_ADMIN")).toBe("events");
    expect(adminRoleSidebarKind("SYSTEM_ADMIN")).toBe("default");
    expect(adminRoleSidebarKind(null)).toBe("default");
  });
});

describe("reading the roles", () => {
  it("reads the grant from the database on every call, so a revoke applies at once", async () => {
    mocks.grantFindFirst.mockResolvedValueOnce({ id: "g1" }).mockResolvedValueOnce(null);
    await expect(isActiveClubsAdministrator("user-1")).resolves.toBe(true);
    await expect(isActiveClubsAdministrator("user-1")).resolves.toBe(false);
    expect(mocks.grantFindFirst).toHaveBeenCalledTimes(2);
    expect(mocks.grantFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "user-1", revokedAt: null } }));
  });

  it("makes an Events Administrator of anyone with an active EVENT_ADMIN membership, and nobody else", async () => {
    mocks.membershipFindMany.mockResolvedValue([{ eventId: "e1" }, { eventId: "e2" }]);
    const roles = await resolveAdminRoles({ id: "user-1", globalRole: null });
    expect(roles).toEqual({ systemAdmin: false, clubsAdministrator: false, eventAdminEventIds: ["e1", "e2"] });
    expect(mocks.membershipFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "user-1", status: "ACTIVE", role: "EVENT_ADMIN" } }));
  });

  it("combines every role one account holds", async () => {
    mocks.grantFindFirst.mockResolvedValue({ id: "g1" });
    mocks.membershipFindMany.mockResolvedValue([{ eventId: "e1" }]);
    const view = await resolveAdminRoleView({ id: "user-1", globalRole: "SYSTEM_ADMIN" });
    expect(view.held).toEqual(["EVENTS_ADMIN", "CLUBS_ADMIN", "SYSTEM_ADMIN"]);
    expect(view.active).toBe("SYSTEM_ADMIN");
  });

  it("ignores a cookie for a role the account does not hold", async () => {
    mocks.cookieValue = "SYSTEM_ADMIN";
    mocks.grantFindFirst.mockResolvedValue({ id: "g1" });
    const view = await resolveAdminRoleView({ id: "user-1", globalRole: null });
    expect(view.held).toEqual(["CLUBS_ADMIN"]);
    expect(view.active).toBe("CLUBS_ADMIN");
  });

  it("drops the Clubs view the moment the grant is revoked, even with the cookie still set", async () => {
    mocks.cookieValue = "CLUBS_ADMIN";
    mocks.membershipFindMany.mockResolvedValue([{ eventId: "e1" }]);
    const view = await resolveAdminRoleView({ id: "user-1", globalRole: null });
    expect(view.held).toEqual(["EVENTS_ADMIN"]);
    expect(view.active).toBe("EVENTS_ADMIN");
  });
});

describe("the switch route", () => {
  const post = (role: string, origin = "https://events.imsda.test") => {
    const body = new FormData();
    body.set("role", role);
    return switchRole(new Request("https://events.imsda.test/api/staff/admin-role", { method: "POST", body, headers: { origin } }));
  };

  it("needs a signed-in account", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    expect((await post("CLUBS_ADMIN")).status).toBe(401);
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin post", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "user-1", globalRole: null } });
    expect((await post("CLUBS_ADMIN", "https://evil.test")).status).toBe(403);
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });

  it("remembers a held role for the session only (httpOnly, no max age) and goes to its home", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "user-1", globalRole: null } });
    mocks.grantFindFirst.mockResolvedValue({ id: "g1" });
    mocks.membershipFindMany.mockResolvedValue([{ eventId: "e1" }]);
    const response = await post("CLUBS_ADMIN");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/admin/clubs");
    expect(mocks.cookieSet).toHaveBeenCalledWith("imsda_admin_role", "CLUBS_ADMIN", expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/" }));
    expect(mocks.cookieSet.mock.calls[0]![2]).not.toHaveProperty("maxAge");
    expect(mocks.cookieSet.mock.calls[0]![2]).not.toHaveProperty("expires");
  });

  it("does not set a role the account does not hold, and stays on the role it has", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "user-1", globalRole: null } });
    mocks.membershipFindMany.mockResolvedValue([{ eventId: "e1" }]);
    for (const role of ["SYSTEM_ADMIN", "CLUBS_ADMIN", "whatever"]) {
      const response = await post(role);
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/events-admin");
    }
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });
});

describe("the switch link (GET /admin-role/<role>)", () => {
  // The switcher's pills link here instead of posting to /api, which Cloudflare challenged on every click.
  const get = (role: string) =>
    switchRoleLink(new Request(`https://events.imsda.test/admin-role/${encodeURIComponent(role)}`), { params: Promise.resolve({ role }) });

  it("sends a signed-out visitor to sign in and sets nothing", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    const response = await get("CLUBS_ADMIN");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login");
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });

  it("remembers a held role for the session only and goes to its home, uncached", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "user-1", globalRole: null } });
    mocks.grantFindFirst.mockResolvedValue({ id: "g1" });
    mocks.membershipFindMany.mockResolvedValue([{ eventId: "e1" }]);
    const response = await get("CLUBS_ADMIN");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/admin/clubs");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.cookieSet).toHaveBeenCalledWith("imsda_admin_role", "CLUBS_ADMIN", expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/" }));
    expect(mocks.cookieSet.mock.calls[0]![2]).not.toHaveProperty("maxAge");
    expect(mocks.cookieSet.mock.calls[0]![2]).not.toHaveProperty("expires");
  });

  it("ignores a role the account does not hold or an unknown one, and stays on the current view's home", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "user-1", globalRole: null } });
    mocks.membershipFindMany.mockResolvedValue([{ eventId: "e1" }]);
    for (const role of ["SYSTEM_ADMIN", "CLUBS_ADMIN", "whatever", "clubs_admin"]) {
      const response = await get(role);
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/events-admin");
    }
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });
});
