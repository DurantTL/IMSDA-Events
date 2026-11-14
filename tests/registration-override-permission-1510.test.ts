import { beforeEach, describe, expect, it, vi } from "vitest";
import { effectivePermissions, requirePermission } from "@/modules/access/authorization";
import { eventPermissions, eventRoles, rolePermissions } from "@/modules/access/permissions";
import { eventExtraText } from "@/modules/access/role-descriptions";

/** #1510: Registration overrides is its own permission, held by no role, granted one membership at a time. Synthetic data only. */
const mocks = vi.hoisted(() => ({ findFirst: vi.fn(), update: vi.fn(), queryRaw: vi.fn(), writeAuditLog: vi.fn() }));
const client = {
  eventMembership: { findFirst: mocks.findFirst, update: mocks.update },
  $queryRaw: mocks.queryRaw,
  $transaction: (work: (tx: unknown) => unknown) => work(client),
};
vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => client }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));

import { RegistrationOverrideAccessError, setRegistrationOverrideAccess, stripRegistrationOverrideAccess } from "@/modules/staff-registration-drafts/override-access";

const admin = { id: "u1", email: "a@example.test", displayName: "Admin", globalRole: "SYSTEM_ADMIN" as const };
const staff = { id: "u2", email: "s@example.test", displayName: "Staff", globalRole: null };
const found = () => ({ id: "m1", userId: "u1", user: { displayName: "Synthetic Staffer", globalRole: null } });
const locked = (role: string, permissions: string[] = [], status = "ACTIVE") => [{ role, status, permissions }];

beforeEach(() => vi.clearAllMocks());

describe("the Registration overrides permission", () => {
  it("exists and is carried by no role, Event Admin included", () => {
    expect(eventPermissions).toContain("OVERRIDE_REGISTRATION_RULES");
    for (const role of eventRoles) expect(rolePermissions[role], role).not.toContain("OVERRIDE_REGISTRATION_RULES");
    expect(rolePermissions.EVENT_ADMIN).toContain("MANAGE_REGISTRATION");
  });

  it("system administrators have it; a named membership holds it only when granted", () => {
    expect(effectivePermissions(admin, null)).toContain("OVERRIDE_REGISTRATION_RULES");
    expect(effectivePermissions(staff, { eventId: "e", userId: "u2", role: "EVENT_ADMIN", status: "ACTIVE", permissions: [] })).not.toContain("OVERRIDE_REGISTRATION_RULES");
    expect(effectivePermissions(staff, { eventId: "e", userId: "u2", role: "REGISTRATION_MANAGER", status: "ACTIVE", permissions: ["OVERRIDE_REGISTRATION_RULES"] })).toContain("OVERRIDE_REGISTRATION_RULES");
  });

  it("requirePermission refuses a registration manager without the grant", async () => {
    const lookup = (permissions: Array<"OVERRIDE_REGISTRATION_RULES">) => async () => ({ eventId: "e", userId: "u2", role: "REGISTRATION_MANAGER" as const, status: "ACTIVE" as const, permissions });
    await expect(requirePermission({ user: staff }, "e", "OVERRIDE_REGISTRATION_RULES", lookup([]))).rejects.toMatchObject({ status: 403 });
    await expect(requirePermission({ user: staff }, "e", "OVERRIDE_REGISTRATION_RULES", lookup(["OVERRIDE_REGISTRATION_RULES"]))).resolves.toBeTruthy();
  });

  it("has its plain-language text", () => {
    expect(eventExtraText.OVERRIDE_REGISTRATION_RULES.name).toBe("Registration overrides");
    expect(eventExtraText.OVERRIDE_REGISTRATION_RULES.summary).toBe("Lets one person send a phone, paper or walk-in registration past a closed or full event, with a reason.");
  });
});

describe("granting Registration overrides", () => {
  it("is refused for a role without registration access, and writes nothing", async () => {
    mocks.findFirst.mockResolvedValue(found());
    mocks.queryRaw.mockResolvedValue(locked("FINANCE_MANAGER"));
    const error = await setRegistrationOverrideAccess("e1", "m1", "admin", true).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RegistrationOverrideAccessError);
    expect((error as RegistrationOverrideAccessError).code).toBe("ROLE_LACKS_REGISTRATION");
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("is allowed for a registration manager, from the locked row, and audited", async () => {
    mocks.findFirst.mockResolvedValue(found());
    mocks.queryRaw.mockResolvedValue(locked("REGISTRATION_MANAGER", ["VIEW_HEALTH_INFORMATION"]));
    await expect(setRegistrationOverrideAccess("e1", "m1", "admin", true)).resolves.toEqual({ granted: true, changed: true });
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "m1" }, data: { permissions: ["VIEW_HEALTH_INFORMATION", "OVERRIDE_REGISTRATION_RULES"] } });
    expect(mocks.writeAuditLog.mock.calls[0]![0]).toMatchObject({ action: "REGISTRATION_OVERRIDE_ACCESS_GRANTED", eventId: "e1", actorUserId: "admin" });
  });

  it("refuses an inactive assignment and a system administrator, and an unchanged state writes nothing", async () => {
    mocks.findFirst.mockResolvedValue(found());
    mocks.queryRaw.mockResolvedValue(locked("REGISTRATION_MANAGER", [], "INACTIVE"));
    await expect(setRegistrationOverrideAccess("e1", "m1", "admin", true)).rejects.toMatchObject({ code: "MEMBERSHIP_INACTIVE" });
    mocks.findFirst.mockResolvedValue({ ...found(), user: { displayName: "Admin", globalRole: "SYSTEM_ADMIN" } });
    await expect(setRegistrationOverrideAccess("e1", "m1", "admin", true)).rejects.toMatchObject({ code: "TARGET_IS_SYSTEM_ADMIN" });
    mocks.findFirst.mockResolvedValue(found());
    mocks.queryRaw.mockResolvedValue(locked("REGISTRATION_MANAGER", []));
    await expect(setRegistrationOverrideAccess("e1", "m1", "admin", false)).resolves.toEqual({ granted: false, changed: false });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("a revoke keeps the other permissions held now", async () => {
    mocks.findFirst.mockResolvedValue(found());
    mocks.queryRaw.mockResolvedValue(locked("READ_ONLY_STAFF", ["OVERRIDE_REGISTRATION_RULES", "VIEW_HEALTH_INFORMATION"]));
    await setRegistrationOverrideAccess("e1", "m1", "admin", false);
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "m1" }, data: { permissions: ["VIEW_HEALTH_INFORMATION"] } });
  });

  it("a role change or deactivation strips it, audited", async () => {
    mocks.queryRaw.mockResolvedValue(locked("REGISTRATION_MANAGER", ["OVERRIDE_REGISTRATION_RULES"]));
    expect(await stripRegistrationOverrideAccess(client as never, { id: "m1", userId: "u1", eventId: "e1" }, "admin", "ROLE_CHANGED")).toBe(true);
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "m1" }, data: { permissions: [] } });
    expect(mocks.writeAuditLog.mock.calls[0]![0]).toMatchObject({ action: "REGISTRATION_OVERRIDE_ACCESS_REVOKED" });
    vi.clearAllMocks();
    mocks.queryRaw.mockResolvedValue(locked("REGISTRATION_MANAGER", []));
    expect(await stripRegistrationOverrideAccess(client as never, { id: "m1", userId: "u1", eventId: "e1" }, "admin", "DEACTIVATED")).toBe(false);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
