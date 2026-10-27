import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { PersonAccess } from "@/components/person-access";
import type { PersonDetail } from "@/modules/system-admin/people-directory";

/**
 * #997, kept for #1275: every action an account row had is still reachable, now as a labelled button on the person
 * page (system administrators only), and only the ones that apply to this person are drawn.
 */
const base: PersonDetail = {
  name: "Sample Person", email: "sample@example.test", staffEmail: "sample@example.test", accountEmail: "sample@example.test",
  staffId: "u-1", accountId: "a-1", systemAdministrator: false, clubsAdministrator: false, areaCoordinator: false,
  staff: { status: "ACTIVE", signInDisabled: false, displayName: "Sample Person", jobTitle: "", phone: "", bio: "", twoStep: "On", lastSignedInAt: null },
  account: { status: "ACTIVE", signInDisabled: false, emailVerified: false, twoStep: "On", lastSignedInAt: null },
  events: [], clubs: [],
};
const render = (person: PersonDetail, scope: "full" | "clubs" = "full", viewerUserId = "u-viewer") => renderToStaticMarkup(createElement(PersonAccess, {
  person, scope, viewerUserId, eventOptions: [], clubOptions: [], linkedEmailChangesTogether: false,
}));

describe("person page account actions (#997, #1275)", () => {
  it("offers every account action for a linked person with two-step on and an unverified email", () => {
    const html = render(base);
    for (const label of [
      "Edit profile", "Send password reset", "Change staff email", "Reset staff two-step", "Disable sign-in",
      "Reset website two-step", "Sign out everywhere", "Change website email", "Send verification email", "Unlink staff login",
    ]) expect(html, label).toContain(label);
    expect(html).not.toContain("Link a staff login");
  });

  it("offers only the actions that apply: no reset without two-step, no verify when verified, Allow when off, Link when unlinked", () => {
    const html = render({
      ...base,
      staffId: null, staffEmail: null, staff: null,
      account: { ...base.account!, twoStep: "Not set up", emailVerified: true },
    });
    expect(html).not.toContain("Reset website two-step");
    expect(html).not.toContain("Send verification email");
    expect(html).not.toContain("Send password reset");
    expect(html).toContain("Link a staff login");
    expect(html).toContain("Needs a staff login");
    const off = render({ ...base, staff: { ...base.staff!, signInDisabled: true } });
    expect(off).toContain("Allow sign-in");
    expect(off).not.toContain("Disable sign-in");
  });

  it("gives you no way to disable your own sign-in or reset your own two-step", () => {
    const html = render({ ...base, systemAdministrator: true }, "full", "u-1");
    expect(html).not.toContain("Disable sign-in");
    expect(html).not.toContain("Reset staff two-step");
    expect(html).toContain("you can&#x27;t switch off your own sign-in");
    expect(html).toContain("You can&#x27;t remove your own");
  });

  it("draws none of them for a Clubs Administrator", () => {
    const html = render(base, "clubs");
    for (const label of ["Edit profile", "Send password reset", "Sign out everywhere", "Change website email", "Disable sign-in"]) {
      expect(html, label).not.toContain(label);
    }
  });
});
