import { describe, expect, it } from "vitest";
import { mfaGateFor, mfaSubjectFromUser, requiresMfa } from "@/modules/access/mfa-rules";

describe("who has to carry a second factor", () => {
  it("requires it of every system administrator, even with no membership", () => {
    expect(requiresMfa({ globalRole: "SYSTEM_ADMIN", activeEventRoles: [], clubsAdministrator: false })).toBe(true);
  });

  it("requires it of an event administrator", () => {
    expect(requiresMfa({ globalRole: null, activeEventRoles: ["EVENT_ADMIN"], clubsAdministrator: false })).toBe(true);
  });

  // Decision 2026-09-25 (#456): every active event role now carries the same
  // requirement, not only EVENT_ADMIN and SYSTEM_ADMIN.
  it("requires it of ordinary event staff too", () => {
    for (const role of ["REGISTRATION_MANAGER", "FINANCE_MANAGER", "COMMUNICATIONS_MANAGER", "CHECK_IN_STAFF", "READ_ONLY_STAFF"]) {
      expect(requiresMfa({ globalRole: null, activeEventRoles: [role], clubsAdministrator: false })).toBe(true);
    }
  });

  // Decision 2026-11-06 (Caleb): an active Clubs Administrator needs it too,
  // even with no event membership.
  it("requires it of an active Clubs Administrator with no event membership", () => {
    expect(requiresMfa({ globalRole: null, activeEventRoles: [], clubsAdministrator: true })).toBe(true);
  });

  it("does not require it of a staff account with no active membership", () => {
    expect(requiresMfa({ globalRole: null, activeEventRoles: [], clubsAdministrator: false })).toBe(false);
  });
});

describe("the sign-in gate", () => {
  // Any active membership now requires a second factor (#456), so this fixture
  // for "carries the requirement" is ordinary event staff, not an admin role.
  const staff = { globalRole: null, activeEventRoles: ["CHECK_IN_STAFF"], clubsAdministrator: false } as const;
  const admin = { globalRole: "SYSTEM_ADMIN", activeEventRoles: [], clubsAdministrator: false } as const;
  // No active membership at all — the one case still left on the password alone.
  const unassigned = { globalRole: null, activeEventRoles: [], clubsAdministrator: false } as const;

  it("asks for a code from anyone with a confirmed authenticator", () => {
    expect(mfaGateFor(staff, { status: "ACTIVE" })).toEqual({ kind: "challenge" });
    expect(mfaGateFor(admin, { status: "ACTIVE" })).toEqual({ kind: "challenge" });
  });

  it("sends a privileged account with no authenticator to enrol", () => {
    expect(mfaGateFor(admin, null)).toEqual({ kind: "enrol" });
    // A half-finished enrolment is not a second factor.
    expect(mfaGateFor(admin, { status: "PENDING" })).toEqual({ kind: "enrol" });
  });

  it("sends ordinary event staff with no authenticator to enrol too (#456)", () => {
    expect(mfaGateFor(staff, null)).toEqual({ kind: "enrol" });
    expect(mfaGateFor(staff, { status: "PENDING" })).toEqual({ kind: "enrol" });
  });

  it("sends a Clubs Administrator with no event membership to enrol, or to a code once enrolled", () => {
    const clubsAdmin = { globalRole: null, activeEventRoles: [], clubsAdministrator: true } as const;
    expect(mfaGateFor(clubsAdmin, null)).toEqual({ kind: "enrol" });
    expect(mfaGateFor(clubsAdmin, { status: "PENDING" })).toEqual({ kind: "enrol" });
    expect(mfaGateFor(clubsAdmin, { status: "ACTIVE" })).toEqual({ kind: "challenge" });
  });

  it("lets a staff account with no active membership through on the password alone", () => {
    expect(mfaGateFor(unassigned, null)).toEqual({ kind: "not_required" });
    expect(mfaGateFor(unassigned, { status: "PENDING" })).toEqual({ kind: "not_required" });
  });
});

describe("granting and revoking the Clubs Administrator role", () => {
  const base = { globalRole: null, memberships: [] as { role: string }[] };

  it("reads a grant with no revoke as required, so the next sign-in enrols", () => {
    const subject = mfaSubjectFromUser({ ...base, clubsAdministratorGrant: { revokedAt: null } });
    expect(subject.clubsAdministrator).toBe(true);
    expect(mfaGateFor(subject, null)).toEqual({ kind: "enrol" });
  });

  it("returns to the password alone after a revoke with no other qualifying role", () => {
    const subject = mfaSubjectFromUser({ ...base, clubsAdministratorGrant: { revokedAt: new Date("2026-11-06T12:00:00Z") } });
    expect(subject.clubsAdministrator).toBe(false);
    expect(mfaGateFor(subject, null)).toEqual({ kind: "not_required" });
  });

  it("stays required after a revoke while an event membership is still active", () => {
    const subject = mfaSubjectFromUser({
      globalRole: null,
      memberships: [{ role: "CHECK_IN_STAFF" }],
      clubsAdministratorGrant: { revokedAt: new Date("2026-11-06T12:00:00Z") },
    });
    expect(requiresMfa(subject)).toBe(true);
  });

  it("is not required for an account that never had a grant", () => {
    expect(requiresMfa(mfaSubjectFromUser({ ...base, clubsAdministratorGrant: null }))).toBe(false);
  });
});
