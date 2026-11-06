import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Sign-in security policy (#456): a session is never created for a staff
 * account that must carry a second factor until that factor is presented —
 * `authenticateWithPassword` returns an `"mfa"` gate, never `"session"`, for
 * every ACTIVE-membership role, not only EVENT_ADMIN and SYSTEM_ADMIN.
 */

const dependencies = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  verifyPassword: vi.fn(),
  spendPasswordCheck: vi.fn(),
  createDatabaseSession: vi.fn(),
  scheduleLockoutEmails: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: dependencies.getPrisma }));
vi.mock("@/modules/access/passwords", () => ({
  hashPassword: vi.fn(),
  verifyPassword: dependencies.verifyPassword,
  spendPasswordCheck: dependencies.spendPasswordCheck,
}));
vi.mock("@/modules/access/session-store", () => ({
  createDatabaseSession: dependencies.createDatabaseSession,
}));
vi.mock("@/modules/communications/lockout-email", () => ({
  scheduleLockoutEmails: dependencies.scheduleLockoutEmails,
}));

import { authenticateWithPassword, checkStaffPasswordNoCount } from "@/modules/access/auth-service";

beforeEach(() => {
  vi.clearAllMocks();
  dependencies.verifyPassword.mockResolvedValue(true);
  dependencies.createDatabaseSession.mockResolvedValue({
    token: "session-token",
    expiresAt: new Date("2030-01-01T00:00:00Z"),
  });
});

function credentialFixture(user: {
  globalRole: "SYSTEM_ADMIN" | null;
  memberships: Array<{ role: string }>;
  mfaEnrollment: { status: "PENDING" | "ACTIVE" } | null;
  clubsAdministratorGrant?: { revokedAt: Date | null } | null;
}) {
  const prisma = {
    user: {
      findUnique: vi.fn().mockResolvedValue({
        id: "user-1",
        accountStatus: "ACTIVE",
        globalRole: user.globalRole,
        memberships: user.memberships,
        clubsAdministratorGrant: user.clubsAdministratorGrant ?? null,
        mfaEnrollment: user.mfaEnrollment,
        passkeys: [],
        credential: {
          id: "cred-1",
          passwordHash: "hash",
          failedAttempts: 0,
          lockedUntil: null,
          disabledAt: null,
        },
      }),
    },
    authCredential: { update: vi.fn().mockResolvedValue({}) },
  };
  dependencies.getPrisma.mockReturnValue(prisma);
  return prisma;
}

const cases: Array<[string, { globalRole: "SYSTEM_ADMIN" | null; memberships: Array<{ role: string }> }]> = [
  ["EVENT_ADMIN", { globalRole: null, memberships: [{ role: "EVENT_ADMIN" }] }],
  ["another event role (READ_ONLY_STAFF)", { globalRole: null, memberships: [{ role: "READ_ONLY_STAFF" }] }],
  ["SYSTEM_ADMIN", { globalRole: "SYSTEM_ADMIN", memberships: [] }],
];

describe.each(cases)("a correct password for %s", (_label, user) => {
  it("does not create a session before a second factor is presented", async () => {
    credentialFixture({ ...user, mfaEnrollment: null });

    const result = await authenticateWithPassword("staff@imsda.org", "correct password", null);

    expect(result?.outcome).not.toBe("session");
    expect(dependencies.createDatabaseSession).not.toHaveBeenCalled();
  });
});

describe("a correct password for a staff account with no active membership", () => {
  it("signs in on the password alone", async () => {
    credentialFixture({ globalRole: null, memberships: [], mfaEnrollment: null });

    const result = await authenticateWithPassword("staff@imsda.org", "correct password", null);

    expect(result?.outcome).toBe("session");
    expect(dependencies.createDatabaseSession).toHaveBeenCalledOnce();
  });
});

describe("a correct password for a Clubs Administrator with no event membership (Nov 6, 2026)", () => {
  const clubsAdmin = { globalRole: null, memberships: [] as Array<{ role: string }>, clubsAdministratorGrant: { revokedAt: null } };

  it("is sent to enrol, with no session, when no second factor exists yet", async () => {
    credentialFixture({ ...clubsAdmin, mfaEnrollment: null });

    const result = await authenticateWithPassword("staff@imsda.org", "correct password", null);

    expect(result).toMatchObject({ outcome: "mfa", gate: "enrol" });
    expect(dependencies.createDatabaseSession).not.toHaveBeenCalled();
  });

  it("is asked for a code, with no session, once enrolled", async () => {
    credentialFixture({ ...clubsAdmin, mfaEnrollment: { status: "ACTIVE" } });

    const result = await authenticateWithPassword("staff@imsda.org", "correct password", null);

    expect(result).toMatchObject({ outcome: "mfa", gate: "challenge" });
    expect(dependencies.createDatabaseSession).not.toHaveBeenCalled();
  });

  it("goes back to the password alone once the grant is revoked and nothing else qualifies", async () => {
    credentialFixture({ globalRole: null, memberships: [], clubsAdministratorGrant: { revokedAt: new Date("2026-11-06T12:00:00Z") }, mfaEnrollment: null });

    const result = await authenticateWithPassword("staff@imsda.org", "correct password", null);

    expect(result?.outcome).toBe("session");
  });
});

describe("a grant that lands while the password is being checked (race)", () => {
  const credential = { id: "cred-1", passwordHash: "hash", failedAttempts: 0, lockedUntil: null, disabledAt: null };
  const base = { id: "user-1", accountStatus: "ACTIVE", globalRole: null, memberships: [], mfaEnrollment: null, passkeys: [] };

  function racingPrisma() {
    // First read: before the grant. Every later read: after it.
    const findUnique = vi.fn()
      .mockResolvedValueOnce({ ...base, clubsAdministratorGrant: null, credential })
      .mockResolvedValue({ ...base, clubsAdministratorGrant: { revokedAt: null } });
    dependencies.getPrisma.mockReturnValue({ user: { findUnique }, authCredential: { update: vi.fn().mockResolvedValue({}) } });
    return findUnique;
  }

  it("password sign-in re-reads the roles and sends the person to enrol instead of minting a session", async () => {
    racingPrisma();
    const result = await authenticateWithPassword("staff@imsda.org", "correct password", null);
    expect(result).toMatchObject({ outcome: "mfa", gate: "enrol" });
    expect(dependencies.createDatabaseSession).not.toHaveBeenCalled();
  });

  it("the unified path re-reads in complete() and does the same", async () => {
    racingPrisma();
    const check = await checkStaffPasswordNoCount("staff@imsda.org", "correct password");
    if (check.kind !== "ok") throw new Error("expected ok");
    const result = await check.complete(null);
    expect(result).toMatchObject({ outcome: "mfa", gate: "enrol" });
    expect(dependencies.createDatabaseSession).not.toHaveBeenCalled();
  });
});

describe("the unified staff password path for a Clubs Administrator (checkStaffPasswordNoCount)", () => {
  const clubsAdmin = { globalRole: null, memberships: [] as Array<{ role: string }>, clubsAdministratorGrant: { revokedAt: null } };

  it.each([
    ["no enrolment", null, "enrol"],
    ["an active enrolment", { status: "ACTIVE" as const }, "challenge"],
  ])("gates with %s and mints no session", async (_label, mfaEnrollment, gate) => {
    credentialFixture({ ...clubsAdmin, mfaEnrollment });
    const check = await checkStaffPasswordNoCount("staff@imsda.org", "correct password");
    if (check.kind !== "ok") throw new Error("expected ok");
    expect(await check.complete(null)).toMatchObject({ outcome: "mfa", gate });
    expect(dependencies.createDatabaseSession).not.toHaveBeenCalled();
  });

  it("signs in on the password alone once the grant is revoked", async () => {
    credentialFixture({ globalRole: null, memberships: [], clubsAdministratorGrant: { revokedAt: new Date("2026-11-06T12:00:00Z") }, mfaEnrollment: null });
    const check = await checkStaffPasswordNoCount("staff@imsda.org", "correct password");
    if (check.kind !== "ok") throw new Error("expected ok");
    expect((await check.complete(null)).outcome).toBe("session");
  });
});
