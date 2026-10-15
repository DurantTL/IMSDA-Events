import { describe, expect, it } from "vitest";
import {
  ATTENDEE_GRADE_METHODS,
  attendeePasskeyCountsAsStaffSecondFactor,
  staffSessionAllowedFor,
} from "@/modules/account-merge/staff-elevation";

/** #554 slice (b): which sign-in methods may open a staff session. Synthetic ids only. */

describe("staff session by sign-in method", () => {
  it("allows the two staff-grade methods", () => {
    expect(staffSessionAllowedFor("STAFF_PASSWORD_AND_SECOND_FACTOR")).toEqual({ allowed: true });
    expect(staffSessionAllowedFor("STAFF_PASSKEY")).toEqual({ allowed: true });
  });

  it.each([
    ["attendee password", "ATTENDEE_PASSWORD"],
    ["Google sign-in", "ATTENDEE_GOOGLE"],
    ["email or magic link", "ATTENDEE_EMAIL_LINK"],
    ["an attendee passkey on its own", "ATTENDEE_PASSKEY"],
  ] as const)("never issues a staff session from %s", (_label, method) => {
    expect(staffSessionAllowedFor(method)).toEqual({ allowed: false, reason: "ATTENDEE_GRADE_METHOD" });
  });

  it("lists exactly the attendee-grade methods as refused", () => {
    expect(ATTENDEE_GRADE_METHODS).toHaveLength(4);
    for (const method of ATTENDEE_GRADE_METHODS) expect(staffSessionAllowedFor(method).allowed).toBe(false);
  });
});

describe("attendee passkey as a staff second factor (decision 5)", () => {
  const base = {
    switchEnabled: true,
    staffPasswordVerified: true,
    passkeyAccountId: "acct-1",
    linkedAttendeeAccountId: "acct-1",
    assertionUserVerified: true,
  };

  it("counts when every condition holds", () => {
    expect(attendeePasskeyCountsAsStaffSecondFactor(base)).toEqual({ counts: true });
  });

  it("is refused when the assertion was not user-verified", () => {
    expect(attendeePasskeyCountsAsStaffSecondFactor({ ...base, assertionUserVerified: false }))
      .toEqual({ counts: false, reason: "USER_VERIFICATION_REQUIRED" });
  });

  it("is never a first factor: the staff password must come first", () => {
    expect(attendeePasskeyCountsAsStaffSecondFactor({ ...base, staffPasswordVerified: false }))
      .toEqual({ counts: false, reason: "STAFF_PASSWORD_REQUIRED_FIRST" });
  });

  it("is refused with the switch off, unlinked, or for another account's passkey", () => {
    expect(attendeePasskeyCountsAsStaffSecondFactor({ ...base, switchEnabled: false }))
      .toEqual({ counts: false, reason: "SWITCH_OFF" });
    expect(attendeePasskeyCountsAsStaffSecondFactor({ ...base, linkedAttendeeAccountId: null }))
      .toEqual({ counts: false, reason: "NOT_LINKED" });
    expect(attendeePasskeyCountsAsStaffSecondFactor({ ...base, passkeyAccountId: "acct-2" }))
      .toEqual({ counts: false, reason: "PASSKEY_OF_ANOTHER_ACCOUNT" });
  });
});
