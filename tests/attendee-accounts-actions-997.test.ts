import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AttendeeAccountsWorkspace } from "@/components/attendee-accounts-workspace";
import type { AttendeeAccountSummary } from "@/modules/system-admin/user-admin";

/** #997: every action an account row had as its own button is still reachable, now from the row's one Actions menu. */
const account = (id: string, over: Partial<AttendeeAccountSummary> = {}): AttendeeAccountSummary => ({
  id, email: `${id}@example.test`, displayName: id, status: "ACTIVE", disabled: false, createdAt: "2026-01-01T00:00:00.000Z",
  lastSignedInAt: null, authenticatorOn: false, passkeyCount: 0, clubRoles: [], areaCoordinator: false, emailVerified: true,
  linkedToStaff: false, ...over,
} as AttendeeAccountSummary);

const menuOf = (html: string) => {
  const start = html.indexOf('<ul class="actions-menu-list"');
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf("</ul>", start));
};

describe("attendee accounts row actions (#997)", () => {
  it("puts every action in the row's Actions menu, named for the account", () => {
    const html = renderToStaticMarkup(createElement(AttendeeAccountsWorkspace, {
      initialAccounts: [account("full", { authenticatorOn: true, emailVerified: false })],
    }));
    expect(html).toContain('aria-label="Actions for full@example.test"');
    expect(html).not.toContain("team-account-actions");
    const menu = menuOf(html);
    for (const label of ["Reset two-step", "Make Area Coordinator", "Sign out everywhere", "Change email", "Link team sign-in", "Send verification email"]) {
      expect(menu, label).toContain(label);
    }
    // No action is left outside the menu as a loose button in the row.
    expect(html.split(menu)[0]).not.toContain("Sign out everywhere");
  });

  it("offers only the actions that apply: no reset without two-step, no verify when verified, unlink and remove when set", () => {
    const html = renderToStaticMarkup(createElement(AttendeeAccountsWorkspace, {
      initialAccounts: [account("plain", { areaCoordinator: true, linkedToStaff: true })],
    }));
    const menu = menuOf(html);
    expect(menu).not.toContain("Reset two-step");
    expect(menu).not.toContain("Send verification email");
    expect(menu).toContain("Remove Area Coordinator");
    expect(menu).toContain("Unlink team sign-in");
    expect(menu).toContain("Change email");
    expect(menu).toContain("Sign out everywhere");
  });
});
