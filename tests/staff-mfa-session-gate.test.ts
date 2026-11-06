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
  revokeDatabaseSession: vi.fn(),
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
  revokeDatabaseSession: dependencies.revokeDatabaseSession,
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
  const base = { id: "user-1", accountStatus: "ACTIVE", globalRole: null, memberships: [], mfaEnrollment: null };
  const before = (passkeys: Array<{ id: string }> = []) => ({ ...base, passkeys, clubsAdministratorGrant: null });
  const after = (passkeys: Array<{ id: string }> = []) => ({ ...base, passkeys, clubsAdministratorGrant: { revokedAt: null } });

  /** Each read in order: 1 = the password lookup, 2 = the re-read before minting, 3 = the re-read after minting. */
  function reads(...results: Array<Record<string, unknown> | null>) {
    const findUnique = vi.fn();
    results.forEach((result, index) => findUnique.mockResolvedValueOnce(index === 0 && result ? { ...result, credential } : result));
    findUnique.mockResolvedValue(results[results.length - 1]);
    dependencies.getPrisma.mockReturnValue({ user: { findUnique }, authCredential: { update: vi.fn().mockResolvedValue({}) } });
    return findUnique;
  }

  async function unified() {
    const check = await checkStaffPasswordNoCount("staff@imsda.org", "correct password");
    if (check.kind !== "ok") throw new Error("expected ok");
    return check.complete(null);
  }

  it("password sign-in re-reads the roles and sends the person to enrol instead of minting a session", async () => {
    reads(before(), after());
    expect(await authenticateWithPassword("staff@imsda.org", "correct password", null)).toMatchObject({ outcome: "mfa", gate: "enrol" });
    expect(dependencies.createDatabaseSession).not.toHaveBeenCalled();
  });

  it("the unified path re-reads in complete() and does the same", async () => {
    reads(before(), after());
    expect(await unified()).toMatchObject({ outcome: "mfa", gate: "enrol" });
    expect(dependencies.createDatabaseSession).not.toHaveBeenCalled();
  });

  it("a grant that commits only after the session insert ends that session and returns the gate", async () => {
    reads(before(), before(), after());
    expect(await authenticateWithPassword("staff@imsda.org", "correct password", null)).toMatchObject({ outcome: "mfa", gate: "enrol" });
    expect(dependencies.createDatabaseSession).toHaveBeenCalledOnce();
    expect(dependencies.revokeDatabaseSession).toHaveBeenCalledWith("session-token");
  });

  it("the unified path ends the just-made session the same way", async () => {
    reads(before(), before(), after());
    expect(await unified()).toMatchObject({ outcome: "mfa", gate: "enrol" });
    expect(dependencies.revokeDatabaseSession).toHaveBeenCalledWith("session-token");
  });

  it("with no late grant the session stands and nothing is revoked", async () => {
    reads(before(), before(), before());
    expect(await authenticateWithPassword("staff@imsda.org", "correct password", null)).toMatchObject({ outcome: "session" });
    expect(dependencies.revokeDatabaseSession).not.toHaveBeenCalled();
  });

  it("a passkey holder who is granted between reads gets passkey_required, with no session", async () => {
    reads(before([{ id: "pk-1" }]), after([{ id: "pk-1" }]));
    expect(await authenticateWithPassword("staff@imsda.org", "correct password", null)).toEqual({ outcome: "passkey_required", userId: "user-1" });
    expect(dependencies.createDatabaseSession).not.toHaveBeenCalled();
  });

  it("a passkey holder granted only after the insert gets passkey_required and the session is ended", async () => {
    reads(before([{ id: "pk-1" }]), before([{ id: "pk-1" }]), after([{ id: "pk-1" }]));
    expect(await authenticateWithPassword("staff@imsda.org", "correct password", null)).toEqual({ outcome: "passkey_required", userId: "user-1" });
    expect(dependencies.revokeDatabaseSession).toHaveBeenCalledWith("session-token");
  });

  it("fails closed when the account vanishes before minting: no session in either path", async () => {
    reads(before(), null);
    expect(await authenticateWithPassword("staff@imsda.org", "correct password", null)).toBeNull();
    reads(before(), null);
    expect(await unified()).toBeNull();
    expect(dependencies.createDatabaseSession).not.toHaveBeenCalled();
  });

  it("fails closed when the account vanishes right after minting: the session is ended", async () => {
    reads(before(), before(), null);
    expect(await authenticateWithPassword("staff@imsda.org", "correct password", null)).toBeNull();
    expect(dependencies.revokeDatabaseSession).toHaveBeenCalledWith("session-token");
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
    expect((await check.complete(null))?.outcome).toBe("session");
  });
});
