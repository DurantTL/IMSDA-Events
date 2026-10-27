import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * #997, kept for #1275: every action an account row had is still reachable, now as a labelled button on the person
 * page (system administrators only), each going to the route the old Accounts and Team pages used.
 */
const source = readFileSync(join(process.cwd(), "components/person-access-controls.tsx"), "utf8");
const page = readFileSync(join(process.cwd(), "components/person-access.tsx"), "utf8");

describe("person page account actions (#997, #1275)", () => {
  it("offers every account action, named for the person", () => {
    for (const label of [
      "Edit profile", "Send password reset", "Change staff email", "Reset staff two-step", "Allow sign-in", "Disable sign-in",
      "Reset website two-step", "Sign out everywhere", "Change website email", "Send verification email", "Unlink staff login", "Link a staff login",
    ]) expect(source, label).toContain(label);
  });

  it("sends each action to the same route as before", () => {
    expect(source).toContain("`/api/admin/users/${encodeURIComponent(staff.id)}`");
    expect(source).toContain("`${staffUrl}/actions`");
    expect(source).toContain("`/api/admin/accounts/${encodeURIComponent(account.id)}`");
    for (const action of ["send-password-reset", "reset-two-step", "change-email", "sign-out", "send-verification", "link-staff", "unlink-staff", "area-coordinator"]) {
      expect(source, action).toContain(action);
    }
  });

  it("offers only the actions that apply: no reset without two-step, no verify when verified, none on yourself", () => {
    expect(source).toContain("!isSelf && staff.twoStepOn");
    expect(source).toContain("account.twoStepOn ?");
    expect(source).toContain("!account.emailVerified ?");
    expect(source).toContain("you can&apos;t switch off your own sign-in");
  });

  it("draws the account actions for a system administrator only", () => {
    expect(page).toMatch(/\{scope === "full" \? \(\s*<section aria-labelledby="people-account"/);
  });
});
