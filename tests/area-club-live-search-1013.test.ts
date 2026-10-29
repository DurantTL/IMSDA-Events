import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

import { AreaClubSearch } from "@/components/area-clubs-views";
import { areaClubSearchHref } from "@/components/area-club-search-form";

/** Live club search on the Area Coordinator tabs (#1013), synthetic data only. */
describe("areaClubSearchHref (#1013)", () => {
  it("keeps year and sort and adds q", () => {
    expect(areaClubSearchHref("/account/area-clubs/points", { q: "eagles", year: "2026", sort: "points" }))
      .toBe("/account/area-clubs/points?year=2026&sort=points&q=eagles");
  });

  it("removes q when the field is empty or only spaces", () => {
    expect(areaClubSearchHref("/account/area-clubs/points", { q: "", year: "2026", sort: "points" }))
      .toBe("/account/area-clubs/points?year=2026&sort=points");
    expect(areaClubSearchHref("/account/clubs", { q: "   " })).toBe("/account/clubs");
  });

  it("encodes the search text", () => {
    expect(areaClubSearchHref("/account/clubs", { q: "Bay & Pines" })).toBe("/account/clubs?q=Bay+%26+Pines");
  });
});

describe("AreaClubSearch markup (#1013)", () => {
  const html = renderToStaticMarkup(createElement(AreaClubSearch, {
    basePath: "/account/area-clubs/points", clubYear: "2026", query: "eagles", shown: 2, sort: "points", total: 9,
  }));

  it("is still a plain GET form that submits q, year and sort", () => {
    expect(html).toContain('action="/account/area-clubs/points"');
    expect(html).toContain('method="get"');
    expect(html).toContain('role="search"');
    expect(html).toContain('name="q"');
    expect(html).toContain('name="year"');
    expect(html).toContain('value="2026"');
    expect(html).toContain('name="sort"');
    expect(html).toContain('type="submit"');
  });

  it("keeps the polite status line and a Clear link that keeps year and sort", () => {
    expect(html).toContain("2 of 9 clubs match");
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('href="/account/area-clubs/points?year=2026&amp;sort=points"');
  });
});

describe("one announcement per search (#1013 review)", () => {
  it("leaves the club list's empty text out of the live region, so only the search status speaks", async () => {
    const { readFileSync } = await import("node:fs");
    const page = readFileSync("components/portal-club-directory.tsx", "utf8");
    expect(page).toContain('<p className="public-manage-empty">{query ? `No ${searchLabel.replace(/^Search by /, "")} matches');
    expect(page).not.toMatch(/public-manage-empty" role="status">\{query \?/);
  });

  it("clears a pending search when Clear is clicked", async () => {
    const { readFileSync } = await import("node:fs");
    const form = readFileSync("components/area-club-search-form.tsx", "utf8");
    expect(form).toMatch(/>Clear<\/Link>/);
    expect(form).toMatch(/onClick=\{\(\) => \{ if \(timer\.current\) clearTimeout\(timer\.current\); \}\}>Clear<\/Link>/);
  });
});
