import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listDirectedClubs: vi.fn(),
  session: vi.fn(),
  enrollment: vi.fn(),
  passkeyCount: vi.fn(),
  passkeysConfigured: vi.fn(),
  areaGrant: vi.fn(),
  instructorCount: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    attendeeSession: { findUnique: mocks.session },
    attendeeMfaEnrollment: { findUnique: mocks.enrollment },
    attendeePasskey: { count: mocks.passkeyCount },
    areaCoordinatorGrant: { findUnique: mocks.areaGrant },
    honorInstructor: { count: mocks.instructorCount },
  }),
}));
vi.mock("@/modules/organizations/director-access", () => ({ listDirectedClubs: mocks.listDirectedClubs }));
vi.mock("@/modules/attendee-accounts/passkeys", () => ({ passkeysConfigured: mocks.passkeysConfigured }));

import {
  accountNeedsSecondStep,
  accountNeedsSignInStep,
  decideClubGate,
  decideSignInStep,
  type SignInGateFacts,
} from "@/modules/attendee-accounts/sign-in-gate";

const WHEN = new Date("2026-12-01T12:00:00Z");
const facts = (overrides: Partial<SignInGateFacts> = {}): SignInGateFacts => ({
  hasSecondStepAccess: true,
  secondFactorVerifiedAt: null,
  emailCodeVerifiedAt: null,
  canVerify: false,
  ...overrides,
});

describe("the two gates (#1410), pure rules", () => {
  it("never asks an account without a club role for anything", () => {
    expect(decideSignInStep(facts({ hasSecondStepAccess: false }))).toBe("OK");
    expect(decideClubGate(facts({ hasSecondStepAccess: false }))).toBe("OK");
  });

  it("a club role without two-step: the code opens its own pages, never club pages", () => {
    expect(decideSignInStep(facts())).toBe("EMAIL_CODE");
    expect(decideSignInStep(facts({ emailCodeVerifiedAt: WHEN }))).toBe("OK");
    expect(decideClubGate(facts())).toBe("SETUP");
    expect(decideClubGate(facts({ emailCodeVerifiedAt: WHEN }))).toBe("SETUP");
  });

  it("an account that has two-step must use it: an emailed code never stands in for it", () => {
    expect(decideSignInStep(facts({ canVerify: true }))).toBe("VERIFY");
    expect(decideSignInStep(facts({ canVerify: true, emailCodeVerifiedAt: WHEN }))).toBe("VERIFY");
    expect(decideClubGate(facts({ canVerify: true, emailCodeVerifiedAt: WHEN }))).toBe("VERIFY");
  });

  it("a real second step in this session opens both", () => {
    expect(decideSignInStep(facts({ canVerify: true, secondFactorVerifiedAt: WHEN }))).toBe("OK");
    expect(decideClubGate(facts({ canVerify: true, secondFactorVerifiedAt: WHEN }))).toBe("OK");
    expect(decideSignInStep(facts({ secondFactorVerifiedAt: WHEN }))).toBe("OK");
  });
});

describe("against the stored session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listDirectedClubs.mockResolvedValue([{ organizationId: "club-1", role: "DIRECTOR" }]);
    mocks.session.mockResolvedValue({ secondFactorVerifiedAt: null, emailCodeVerifiedAt: null });
    mocks.enrollment.mockResolvedValue(null);
    mocks.passkeyCount.mockResolvedValue(0);
    mocks.passkeysConfigured.mockResolvedValue(true);
    mocks.areaGrant.mockResolvedValue(null);
    mocks.instructorCount.mockResolvedValue(0);
  });

  it("a new director signs in with the emailed code, sees their own pages, and still meets the club gate", async () => {
    await expect(accountNeedsSignInStep("a1", "s1")).resolves.toBe("EMAIL_CODE");
    mocks.session.mockResolvedValue({ secondFactorVerifiedAt: null, emailCodeVerifiedAt: WHEN });
    await expect(accountNeedsSignInStep("a1", "s1")).resolves.toBe("OK");
    await expect(accountNeedsSecondStep("a1", "s1")).resolves.toBe("SETUP");
  });

  it("the code is read from this session only", async () => {
    await accountNeedsSignInStep("a1", "s1");
    expect(mocks.session).toHaveBeenCalledWith({ where: { id: "s1" }, select: { secondFactorVerifiedAt: true, emailCodeVerifiedAt: true } });
  });

  it("an account with an active authenticator, or a passkey with passkeys on, verifies instead", async () => {
    mocks.enrollment.mockResolvedValue({ status: "ACTIVE" });
    await expect(accountNeedsSignInStep("a1", "s1")).resolves.toBe("VERIFY");
    mocks.enrollment.mockResolvedValue(null);
    mocks.passkeyCount.mockResolvedValue(1);
    await expect(accountNeedsSignInStep("a1", "s1")).resolves.toBe("VERIFY");
    mocks.passkeysConfigured.mockResolvedValue(false);
    await expect(accountNeedsSignInStep("a1", "s1")).resolves.toBe("EMAIL_CODE");
  });

  it("area coordinators and honors instructors get the same two gates as directors", async () => {
    mocks.listDirectedClubs.mockResolvedValue([]);
    mocks.areaGrant.mockResolvedValue({ revokedAt: null, expiresAt: null });
    await expect(accountNeedsSignInStep("a1", "s1")).resolves.toBe("EMAIL_CODE");
    mocks.areaGrant.mockResolvedValue(null);
    mocks.instructorCount.mockResolvedValue(1);
    await expect(accountNeedsSignInStep("a1", "s1")).resolves.toBe("EMAIL_CODE");
  });

  it("an ordinary attendee, and a staff act-as with no session, are untouched and read nothing about the session", async () => {
    mocks.listDirectedClubs.mockResolvedValue([]);
    await expect(accountNeedsSignInStep("a1", "s1")).resolves.toBe("OK");
    expect(mocks.session).not.toHaveBeenCalled();
    await expect(accountNeedsSignInStep("a1", null)).resolves.toBe("OK");
  });
});
