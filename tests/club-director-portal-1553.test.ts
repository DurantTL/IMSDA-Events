import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/account/clubs/club-1/records", useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: vi.fn() }) }));

import { HonorsReportMemberPicker } from "@/components/honors-report-member-picker";
import { ContextualHelp } from "@/components/contextual-help";
import { HelpBackLink } from "@/components/help-return";
import { clubHelpReturnPath, helpHrefFrom, HELP_RETURN_STORAGE_KEY } from "@/lib/help-return";

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

describe("honors print report, one person (#1553)", () => {
  const members = [{ memberId: "m1", label: "Avery Example" }, { memberId: "m2", label: "Blake Example" }];
  it("renders the shared search box with the chosen member, not a drop-down", () => {
    const html = renderToStaticMarkup(createElement(HonorsReportMemberPicker, { members, memberId: "m2" }));
    expect(html).toContain('role="combobox"');
    expect(html).toContain('value="Blake Example"');
    expect(html).toContain('name="member"');
    expect(html).toMatch(/<input[^>]*name="member"[^>]*value="m2"|<input[^>]*type="hidden"[^>]*value="m2"/);
    expect(html.replace(/<noscript>[\s\S]*?<\/noscript>/, "")).not.toContain("<select");
  });
  it("still works without scripts: a plain member select inside noscript, ahead of the search box", () => {
    const html = renderToStaticMarkup(createElement(HonorsReportMemberPicker, { members, memberId: "m2" }));
    const noscript = html.slice(html.indexOf("<noscript>"), html.indexOf("</noscript>"));
    expect(noscript).toContain('<select name="member"');
    expect(noscript).toContain('<option value="m1">Avery Example</option>');
    expect(noscript).toMatch(/<option value="m2" selected/);
    expect(html.indexOf("<noscript>")).toBeLessThan(html.indexOf('role="combobox"'));
    expect(noscript).toContain("honors-report-member-search{display:none}");
  });
  it("does not submit when the box is cleared", () => {
    const source = read("components/honors-report-member-picker.tsx");
    expect(source.indexOf('if (value === "") return;')).toBeGreaterThan(-1);
    expect(source.indexOf('if (value === "") return;')).toBeLessThan(source.indexOf("requestSubmit()"));
  });
  it("is used by the report page in place of the member select", () => {
    const page = read("app/(public)/account/(portal)/clubs/[organizationId]/exports/honors/page.tsx");
    expect(page).toContain("HonorsReportMemberPicker");
    expect(page).not.toContain('name="member"');
  });
});

describe("honor pickers share one search component (#1553)", () => {
  it("the club order picker uses HonorCombobox, with no second drop-down", () => {
    const source = read("components/club-order-workspace.tsx");
    expect(source).toContain("<HonorCombobox");
    expect(source).not.toContain("club-order-picker-item");
    expect(source).not.toContain("club-order-picker-search");
  });
  it("every club-portal honor picker is the shared HonorCombobox", () => {
    for (const file of ["components/club-honors-workspace.tsx", "components/club-member-honors-dialog.tsx", "components/club-order-workspace.tsx"]) {
      expect(read(file), file).toContain("HonorCombobox");
    }
  });
});

describe("Help back link (#1553)", () => {
  it("accepts only internal club portal paths", () => {
    expect(clubHelpReturnPath("/account/clubs/club-1/records")).toBe("/account/clubs/club-1/records");
    expect(clubHelpReturnPath("/account/clubs/club-1/records?month=2026-10")).toBe("/account/clubs/club-1/records?month=2026-10");
    expect(clubHelpReturnPath("/account/clubs")).toBe("/account/clubs");
    for (const bad of ["https://evil.example/account/clubs/x", "//evil.example", "/\\evil.example", "/account/clubs/../../api/x", "/account/clubs//x", "/account/profile", "/api/attendee/clubs/x", "/account/clubs/x%2F%2Fevil", "javascript:alert(1)", "", null, undefined, ["a"]]) {
      expect(clubHelpReturnPath(bad as string), String(bad)).toBeNull();
    }
  });
  it("adds a validated from to a help link", () => {
    expect(helpHrefFrom("/account/help/director-monthly-record", "/account/clubs/club-1/records")).toBe("/account/help/director-monthly-record?from=%2Faccount%2Fclubs%2Fclub-1%2Frecords");
    expect(helpHrefFrom("/account/help/x", "https://evil.example")).toBe("/account/help/x");
  });
  it("the guide Back link goes to the club page it came from, else to Help", () => {
    const withFrom = renderToStaticMarkup(createElement(HelpBackLink, { fallbackHref: "/account/help", fallbackLabel: "Back to Help", from: "/account/clubs/club-1/roster" }));
    expect(withFrom).toContain('href="/account/clubs/club-1/roster"');
    const without = renderToStaticMarkup(createElement(HelpBackLink, { fallbackHref: "/account/help", fallbackLabel: "Back to Help", from: "https://evil.example" }));
    expect(without).toContain('href="/account/help"');
    expect(without).not.toContain("evil.example");
  });
  it("the contextual Help full-guide link carries the current club page", () => {
    const html = renderToStaticMarkup(createElement(ContextualHelp, { help: { guideId: "g", title: "T", summary: "S", steps: ["a"], fullHref: "/account/help/g" } }));
    expect(html).toContain("/account/help/g?from=%2Faccount%2Fclubs%2Fclub-1%2Frecords");
  });
  it("a guide never uses the remembered club page; only the Help index may", () => {
    const store = new Map<string, string>([[HELP_RETURN_STORAGE_KEY, "/account/clubs/club-1/roster"]]);
    vi.stubGlobal("window", { sessionStorage: { getItem: (key: string) => store.get(key) ?? null } });
    try {
      // renderToStaticMarkup uses the server snapshot, so check precedence through the source contract instead.
      const source = read("components/help-return.tsx");
      expect(source).toContain("(useRemembered ? stored : null)");
      expect(source).toContain("pathname.startsWith(\"/account/help\")");
      expect(source).toContain("removeItem(HELP_RETURN_STORAGE_KEY)");
      expect(source).toContain("useSearchParams()");
      expect(read("app/(public)/account/(portal)/help/[guideId]/page.tsx")).not.toContain("useRemembered");
      expect(read("app/(public)/account/(portal)/help/page.tsx")).toContain("useRemembered");
    } finally { vi.unstubAllGlobals(); }
  });
  it("the Help index shows Back only when a club page is known", () => {
    const hidden = renderToStaticMarkup(createElement(HelpBackLink, { fallbackHref: "/account/clubs", fallbackLabel: "", from: null, hideWithoutTarget: true }));
    expect(hidden).toBe("");
    const shown = renderToStaticMarkup(createElement(HelpBackLink, { fallbackHref: "/account/clubs", fallbackLabel: "", from: "/account/clubs/club-1/honors", hideWithoutTarget: true }));
    expect(shown).toContain('href="/account/clubs/club-1/honors"');
    expect(read("app/(public)/account/(portal)/help/page.tsx")).toContain("hideWithoutTarget");
  });
  it("the portal layout tracks the club page and the guide page reads a validated from", () => {
    expect(read("app/(public)/account/(portal)/layout.tsx")).toContain("<HelpReturnTracker />");
    const guide = read("app/(public)/account/(portal)/help/[guideId]/page.tsx");
    expect(guide).toContain("clubHelpReturnPath(firstParam(query.from))");
    expect(guide).toContain("<HelpBackLink");
  });
});
