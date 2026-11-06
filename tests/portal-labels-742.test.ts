import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** Portal labels (#742): the menu label, page heading and Back text agree. Reads source; synthetic only. */
const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const portal = "app/(public)/account/(portal)";

describe("portal labels (#742)", () => {
  it("calls the account tab and its page My registrations", () => {
    expect(read("components/account-portal-nav.ts")).toContain('label: "My registrations"');
    expect(read(`${portal}/registrations/page.tsx`)).toContain('<AccountPageBanner title="My registrations">');
    expect(read("components/account-page-banner.tsx")).toContain("<h1>{title}</h1>");
  });

  it("keeps the account tab order: Overview, My registrations, Profile, then any club tab, Club coordination and Help (#1111, #1551)", () => {
    const nav = read("components/account-portal-nav.ts");
    const order = ['label: "Overview"', 'label: "My registrations"', 'label: "Profile"', 'href: "/account/clubs"', 'label: "Club coordination"', 'label: "Help"'].map((text) => nav.indexOf(text));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Waitlists is a Club coordination tab only, never a menu item of its own.
    expect(nav).not.toContain('label: "Waitlists"');
  });

  it("names the club events tab, heading and Back link alike", () => {
    expect(read("components/club-event-list.tsx")).toContain(">Club events</h2>");
    expect(read(`${portal}/clubs/[organizationId]/events/[eventId]/page.tsx`)).toContain("Back to club events");
  });

  it("names the club settings page and its form alike", () => {
    expect(read(`${portal}/clubs/[organizationId]/club-info/page.tsx`)).toContain('title: "Club settings"');
    expect(read("components/club-profile-form.tsx")).toContain(">Club settings</p>");
  });

  it("sends the Area Coordinator health list back to Clubs at a glance, not the account", () => {
    const source = read(`${portal}/area/health/page.tsx`);
    expect(source).not.toContain("Back to your account");
    expect(source).toContain('<BackLink href="/account/area-clubs/overview#clubs-at-a-glance">Back to clubs at a glance</BackLink>');
  });

  it("drops the second Your registrations eyebrow", () => {
    expect(read(`${portal}/registrations/page.tsx`)).not.toContain("Your registrations</p>");
  });
});
