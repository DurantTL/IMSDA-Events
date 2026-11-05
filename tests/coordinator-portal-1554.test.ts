import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/** Area Coordinator portal fixes (#1554): month switch keeps position, collapsible events, club-style header. Synthetic data only. */
vi.mock("server-only", () => ({}));

import { CoordinatorMonthPicker } from "@/components/coordinator-monthly-records";
import { CoordinatorClubEvents, COORDINATOR_EVENTS_OPEN_BY_DEFAULT } from "@/components/coordinator-destinations";
import { summarizeClub } from "@/modules/club-reports/area-summary-domain";
import type { AreaClubEvent } from "@/modules/club-reports/area-summary-repository";

const read = (path: string) => readFileSync(path, "utf8");
const now = new Date("2026-11-15T15:00:00Z");

describe("Monthly Records month switch (#1554)", () => {
  it("does not scroll to the top when a month link is followed", () => {
    const club = summarizeClub({ id: "c1", name: "Alpha", church: "Alpha Church", directors: ["Dana Sample"], rosterSize: 5, adultCount: 2, registrationOnTime: true, backgroundChecks: { missing: 0, notInCompliance: 0, expiringSoon: 0 }, reports: [] }, "2026-27", now);
    const html = renderToStaticMarkup(createElement(CoordinatorMonthPicker, { clubYear: "2026-27", month: "2026-11", query: "", clubs: [club], now }));
    // The 12 month links plus Previous and Next all carry the no-scroll option; server markup has no attribute, so check the source too.
    expect(html).toContain("Report month");
    const source = read("components/coordinator-monthly-records.tsx");
    const picker = source.slice(source.indexOf("export function CoordinatorMonthPicker"), source.indexOf("/** Submitted, Not submitted"));
    expect(picker.match(/<Link\b/g)?.length).toBe(3);
    expect(picker.match(/scroll=\{false\}/g)?.length).toBe(3);
  });
});

describe("Club events collapse (#1554)", () => {
  const makeEvent = (n: number): AreaClubEvent => ({
    id: `event-${n}`, name: `Synthetic Event ${n}`, startsAt: "2026-10-09T12:00:00Z", timezone: "America/Chicago",
    clubs: [{ organizationId: "club-1", name: "Alpha", church: "Alpha Church", status: "REGISTERED", headcount: 12 }],
  } as unknown as AreaClubEvent);
  const events = [1, 2, 3, 4, 5].map(makeEvent);
  const render = (query = "") => renderToStaticMarkup(createElement(CoordinatorClubEvents, { clearHref: "/x", events, query }));

  it("opens the first three events and closes the rest", () => {
    expect(COORDINATOR_EVENTS_OPEN_BY_DEFAULT).toBe(3);
    const details = render().match(/<details[^>]*>/g) ?? [];
    expect(details).toHaveLength(5);
    expect(details.filter((tag) => /\bopen=""/.test(tag))).toHaveLength(3);
    expect(details[3]).not.toContain("open");
  });

  it("names each event in its summary, with the date and headcount", () => {
    const html = render();
    expect(html).toMatch(/<summary[^>]*><div[^>]*><h3[^>]*>Synthetic Event 1<\/h3>.*October 9, 2026.*12 people/);
    for (const summary of html.match(/<summary[\s\S]*?<\/summary>/g) ?? []) expect(summary).not.toContain("<a ");
  });

  it("opens every match while a search is active", () => {
    const details = render("Alpha").match(/<details[^>]*>/g) ?? [];
    expect(details.every((tag) => /\bopen=""/.test(tag))).toBe(true);
  });

  it("shows a chevron in every summary, hides the native marker and keeps the h3 out of a span", () => {
    const html = render();
    expect(html.match(/<svg[^>]*lucide-chevron-down[^>]*aria-hidden="true"/g) ?? []).toHaveLength(5);
    expect(html).toContain("<div class=\"_summaryText");
    expect(html).not.toMatch(/<span[^>]*><h3/);
    const css = read("components/coordinator-destinations.module.css");
    expect(css).toContain("list-style: none");
    expect(css).toContain("::-webkit-details-marker");
    expect(css).toMatch(/\.event\[open\][^{]*\.chevron \{[^}]*rotate/);
    expect(css).toContain("prefers-reduced-motion");
  });

  it("gives the summary a 44px tap target in a CSS module", () => {
    const css = read("components/coordinator-destinations.module.css");
    expect(css).toMatch(/\.summary \{[^}]*min-height: 44px/);
  });
});

describe("Coordinator header (#1554)", () => {
  it("uses the club director banner instead of the account hero", () => {
    const layout = read("components/coordinator-banner.tsx");
    expect(read("app/(public)/account/(portal)/area-clubs/layout.tsx")).toContain("<CoordinatorBanner />");
    expect(layout).toContain('className="club-banner"');
    expect(layout).toContain('className="club-banner-inner"');
    expect(layout).toContain('className="club-banner-identity"');
    expect(layout).toContain("<h1>Club coordination</h1>");
    expect(layout).toContain("Area Coordinator · view only");
    expect(layout).not.toContain("account-page-hero");
    expect(layout).not.toContain("public-registration-hero");
  });
});
