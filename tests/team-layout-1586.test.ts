import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/staff", useSearchParams: () => new URLSearchParams() }));

import { pageOwnsHeader } from "@/components/page-header-routes";
import { staffPageTitles } from "@/components/staff-navigation";
import { StaffWorkspace } from "@/components/staff-workspace";

// #1586: the inside of the Team page. Synthetic data only.
const render = (props: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(StaffWorkspace, {
  eventId: "event_1", eventName: "Synthetic Camporee", initialMemberships: [], currentUserId: "user-1", currentUserIsSystemAdmin: false, canAddStaff: true, ...props,
}));

describe("Team page layout (#1586)", () => {
  it("draws one h1 titled like the tab, with no eyebrow or hidden duplicate heading", () => {
    const markup = render();
    expect(staffPageTitles.team).toBe("Team");
    expect(markup.match(/<h1/g)).toHaveLength(1);
    expect(markup).toMatch(/<h1[^>]*>Team<\/h1>/);
    expect(markup).not.toContain("duplicate-page-title");
    expect(markup).not.toContain(">Event access</p>");
    expect(markup).not.toContain(">Permission matrix</p>");
  });

  it("is listed so the shell draws no second h1", () => {
    expect(pageOwnsHeader("/staff")).toBe(true);
    expect(pageOwnsHeader("/staff-training")).toBe(false);
  });

  it("gives the restricted view the same title", () => {
    const page = readFileSync(path.join(process.cwd(), "app/(workspace)/staff/page.tsx"), "utf8");
    expect(page).toContain("<PageHeader title={staffPageTitles.team} />");
  });

  it("keeps Add staff as the one filled button beside the active count", () => {
    const markup = render();
    expect(markup.match(/class="primary-button"/g)).toHaveLength(1);
    expect(markup).toMatch(/class="primary-button"[^>]*>.*Add staff<\/button>/);
    expect(markup).toContain("0 active");
  });

  it("shows no Add staff button to a viewer who cannot add staff", () => {
    expect(render({ canAddStaff: false })).not.toContain("Add staff");
  });

  it("names the role section with a real heading", () => {
    expect(render()).toMatch(/<h2 id="staff-role-boundaries">Role boundaries<\/h2>/);
  });
});
