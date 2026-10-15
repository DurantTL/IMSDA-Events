import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #554 slice (c): no attendee-grade sign-in ever produces a staff session.
 * One test per method: attendee password (with a valid staff TOTP code
 * typed afterwards), Google, an email link or code, and an attendee passkey on
 * its own. The behavioural checks live in `unified-sign-in-route.test.ts` (password) and
 * `scripts/verify-staff-attendee-activation.ts` / `scripts/verify-unified-sign-in.ts`
 * (real database); this file adds the structural guarantee and the Google flow.
 */

const mocks = vi.hoisted(() => ({ getPrisma: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));

import { signInWithGoogle } from "@/modules/attendee-accounts/federated-sign-in";
import { staffSessionAllowedFor } from "@/modules/account-merge/staff-elevation";

function sources(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("attendee-side sign-in code cannot create a staff session", () => {
  const attendeeSide = [
    ...sources("modules/attendee-accounts"),
    ...sources("app/api/attendee"),
  ].filter((file) => !file.endsWith("current-attendee.ts"));

  it("has no reference to the staff session store, cookie or MFA completion", () => {
    expect(attendeeSide.length).toBeGreaterThan(20);
    for (const file of attendeeSide) {
      const text = readFileSync(file, "utf8").split("\n")
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join("\n");
      const hit = text.match(/createDatabaseSession|userSession\.|[^_A-Z]SESSION_COOKIE_NAME\b|completeMfaChallenge|from "@\/modules\/access\/(session-store|mfa-service)"/);
      expect(hit, `${file} must not touch the staff session`).toBeNull();
    }
  });

  it.each([
    ["attendee password (even followed by a valid staff TOTP code)", "ATTENDEE_PASSWORD"],
    ["Google sign-in", "ATTENDEE_GOOGLE"],
    ["an email link or code", "ATTENDEE_EMAIL_LINK"],
    ["an attendee passkey on its own", "ATTENDEE_PASSKEY"],
  ] as const)("%s is attendee-grade", (_label, method) => {
    expect(staffSessionAllowedFor(method)).toEqual({ allowed: false, reason: "ATTENDEE_GRADE_METHOD" });
  });

  it("the attendee passkey sign-in route and module open only an attendee session", () => {
    const passkeySignIn = readFileSync("modules/attendee-accounts/passkeys.ts", "utf8");
    expect(passkeySignIn).toContain("createAttendeeSession");
    expect(passkeySignIn).not.toContain("createDatabaseSession");
    const route = readFileSync("app/api/attendee/passkeys/sign-in/route.ts", "utf8");
    expect(route).toContain("ATTENDEE_SESSION_COOKIE_NAME");
    expect(route).not.toMatch(/[^_A-Z]SESSION_COOKIE_NAME\b/);
  });
});

describe("Google sign-in for a staff address", () => {
  beforeEach(() => vi.clearAllMocks());

  it("opens an attendee session and writes no staff session", async () => {
    const userSessionCreate = vi.fn();
    const attendeeSessionCreate = vi.fn(async () => ({}));
    mocks.getPrisma.mockReturnValue({
      attendeeIdentity: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(),
      },
      // A staff email with no attendee account yet: Google creates one, as for any new address.
      attendeeAccount: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(async () => ({ id: "acct-new" })),
      },
      attendeeSession: { create: attendeeSessionCreate },
      userSession: { create: userSessionCreate },
      user: { findUnique: vi.fn(async () => ({ id: "staff-1" })) },
    });
    const result = await signInWithGoogle(
      { subject: "sub-1", email: "staff.person@example.test", emailVerified: true, name: "Staff Person" },
      null,
    );
    expect(result.outcome).toBe("signed-in");
    expect(attendeeSessionCreate).toHaveBeenCalledTimes(1);
    expect(userSessionCreate).not.toHaveBeenCalled();
  });
});
