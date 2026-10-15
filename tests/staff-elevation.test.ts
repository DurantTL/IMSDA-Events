import { describe, expect, it } from "vitest";
import * as elevation from "@/modules/account-merge/staff-elevation";
import {
  ATTENDEE_GRADE_METHODS,
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

describe("attendee passkey is never a staff second factor (Caleb, Oct 15, 2026)", () => {
  it("retires the decision-5 helper so nothing can wire it", () => {
    expect(Object.keys(elevation).sort()).toEqual(["ATTENDEE_GRADE_METHODS", "staffSessionAllowedFor"]);
    expect("attendeePasskeyCountsAsStaffSecondFactor" in elevation).toBe(false);
  });

  it("has no staff-grade method that names an attendee passkey", () => {
    expect(elevation.staffSessionAllowedFor("ATTENDEE_PASSKEY").allowed).toBe(false);
  });
});
