import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

import { clubBannerYearLabel } from "@/components/club-banner-year";
import { clubMastheadModel, ClubPortalMastheadView } from "@/components/club-portal-masthead-view";
import { readFileSync } from "node:fs";

/** The club masthead identity and the banner's year (#1165). Synthetic names only. */

const account = { displayName: "Sample Director" };
const base = { account, secondStepPending: false, actingAs: false, clubCount: 1, signOut: "attendee" as const };
const html = (over: Partial<Parameters<typeof clubMastheadModel>[0]>) => renderToStaticMarkup(createElement(ClubPortalMastheadView, { model: clubMastheadModel({ ...base, ...over }), role: "DIRECTOR" }));

describe("club masthead identity (#1165, #442)", () => {
  it("shows the attendee, My account and Sign out for a signed-in director of one club, with no Switch club", () => {
    const out = html({ clubCount: 1 });
    expect(out).toContain("Sample Director");
    expect(out).toContain('href="/account"');
    expect(out).not.toContain("Switch club");
    expect(out).toContain("Sign out");
  });

  it.each([[0], [1]])("offers no Switch club with %s clubs", (clubCount) => {
    expect(html({ clubCount })).not.toContain("Switch club");
  });

  it("offers Switch club, to the existing clubs list, with more than one club", () => {
    expect(html({ clubCount: 2 })).toContain('href="/account/clubs"');
    expect(html({ clubCount: 2 })).toContain("Switch club");
  });

  it("shows no attendee identity, My account or Switch club while a staff act-as is active, and says so", () => {
    const out = html({ actingAs: true, clubCount: 3, signOut: "none" });
    expect(out).toContain("Acting as club director");
    expect(out).not.toContain("Sample Director");
    expect(out).not.toContain("My account");
    expect(out).not.toContain("Switch club");
    expect(out).not.toContain("Sign out");
  });

  it("hides the attendee identity, My account and Switch club while this session's second step is pending", () => {
    const out = html({ secondStepPending: true, clubCount: 3 });
    expect(out).not.toContain("Sample Director");
    expect(out).not.toContain("My account");
    expect(out).not.toContain("Switch club");
    expect(out).not.toContain("Acting as");
  });

  it("never links to a staff or system destination", () => {
    for (const over of [{}, { clubCount: 2 }, { actingAs: true }, { secondStepPending: true }]) {
      expect(html(over)).not.toMatch(/href="\/(admin|overview|system|staff)/);
    }
  });

  it("is rendered from the same act-as and second-step signals the portal layout uses", () => {
    const source = readFileSync("components/club-portal-masthead.tsx", "utf8");
    expect(source).toContain("accountNeedsSecondStep");
    expect(source).toContain("currentStaffActingContext");
  });
});

describe("club banner year (#1165)", () => {
  const now = new Date("2026-10-24T12:00:00Z");

  it("shows the current club year when there is no year, or an unknown one", () => {
    expect(clubBannerYearLabel(null, now)).toEqual({ label: "Current club year", value: "2026–27" });
    expect(clubBannerYearLabel("2019-20", now)).toEqual({ label: "Current club year", value: "2026–27" });
    expect(clubBannerYearLabel("2026-27", now).label).toBe("Current club year");
  });

  it("shows the previous year as viewed and read-only", () => {
    expect(clubBannerYearLabel("2025-26", now)).toEqual({ label: "Viewing", value: "2025–26 (read-only)" });
  });

  it("shows next year as next year, read-only", () => {
    expect(clubBannerYearLabel("2027-28", now)).toEqual({ label: "Next club year", value: "2027–28 (read-only)" });
  });
});
