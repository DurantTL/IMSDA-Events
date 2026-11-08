import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Site rule B17 (#1557, Caleb, Nov 6): "Changing a filter, tab, sort or month keeps you where you are, and nothing on
// the page jumps while it loads." Behavior is covered in tests/keep-scroll-1557.test.ts; this is the source-level guard
// that keeps the pieces in place so a new page cannot quietly go back to jumping to the top. The real-browser check is
// scripts/verify-keep-place.ts (npm run test:keep-place).

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

function sourceFiles(dir: string): string[] {
  return readdirSync(path.join(process.cwd(), dir)).flatMap((name) => {
    const relative = `${dir}/${name}`;
    if (statSync(path.join(process.cwd(), relative)).isDirectory()) return sourceFiles(relative);
    return relative.endsWith(".tsx") ? [relative] : [];
  });
}

// Files whose `<form method="get">` is a filter or search form that was not moved to GetFilterForm yet. Each is either
// a search-as-you-type form (it updates the list in place with its own handler), a form that submits to a different
// page on purpose, or an old plain form kept on this list. A new raw GET form fails; folding one of these into
// `GetFilterForm` (components/get-filter-form.tsx) is how the list shrinks, and the entry is deleted with it.
const RAW_GET_FORMS: Record<string, { forms: number; why: string }> = {
  "app/(public)/account/(portal)/clubs/[organizationId]/exports/class-tracking/page.tsx": { forms: 1, why: "report options; the Download buttons need a real GET" },
  "app/(public)/account/(portal)/clubs/[organizationId]/exports/honors/page.tsx": { forms: 1, why: "report options (AutoSubmitForm); the Download buttons need a real GET" },
  "app/(public)/account/(portal)/clubs/[organizationId]/forms/page.tsx": { forms: 1, why: "old plain filter form on a short list" },
  "components/forms-create/forms-create-section.tsx": { forms: 1, why: "Create a form event picker (rendered once per event-scoped card); navigates to the builder, not a filter" },
  "app/(workspace)/check-in/badges/page.tsx": { forms: 1, why: "badge print controls; the print buttons need a real GET" },
  "app/(workspace)/more/club-forms/page.tsx": { forms: 1, why: "old plain filter form on a short list" },
  "app/(workspace)/more/reports/clubs/check-in-book/page.tsx": { forms: 1, why: "report options; the print buttons need a real GET" },
  "components/area-club-search-form.tsx": { forms: 1, why: "search as you type (useListNavigation)" },
  "components/choice-answer-filter.tsx": { forms: 1, why: "filter that goes to /people on purpose" },
  "components/desk-location-select.tsx": { forms: 1, why: "check-in desk choice, a one-field form that changes the desk, not a list" },
  "components/organization-search-controls.tsx": { forms: 1, why: "search as you type (useListNavigation)" },
  "components/people-quick-filters.tsx": { forms: 1, why: "people search box; its own in-place submit handler" },
  "components/public-club-directory.tsx": { forms: 1, why: "public search box; search as you type" },
  "components/search-as-you-type.tsx": { forms: 1, why: "the shared search-as-you-type form" },
};

// Pages and components that were moved to GetFilterForm in #1557 and must keep using it.
const USES_GET_FILTER_FORM = [
  "app/(workspace)/admin/clubs/page.tsx",
  "components/clubs-year-selector.tsx",
  "components/club-leaders-list.tsx",
  "components/people-directory.tsx",
  "components/staff-monthly-records.tsx",
];

describe("keep the reader's place (B17, #1557)", () => {
  it("GuardedLink decides scroll with resolveLinkScroll, for the link and for the router", () => {
    const source = read("components/guarded-link.tsx");
    expect(source).toContain('import { handleGuardedLinkClick, resolveLinkScroll } from "@/components/link-guard"');
    expect(source).toContain("scroll={scrollTo}");
    expect(source).toMatch(/router\.replace\(href, \{ scroll: scrollNow \}\)/);
    expect(source).toMatch(/router\.push\(href, \{ scroll: scrollNow \}\)/);
  });

  it("a same-page query change keeps scroll, and an explicit scroll wins", () => {
    const source = read("components/link-guard.ts");
    expect(source).toContain("export function resolveLinkScroll");
    expect(source).toMatch(/return false;/);
  });

  it("every server-sorted column header goes through PhoneHiddenSortLink, which passes scroll={false}", () => {
    expect(read("components/phone-hidden-sort-link.tsx")).toContain("scroll={false}");
    const sort = read("components/list-sort.tsx");
    expect(sort).toContain("<PhoneHiddenSortLink");
    // No second kind of sort link in the shared header.
    expect(sort).not.toMatch(/<Link\b/);
    expect(sort).not.toMatch(/from "next\/link"/);
  });

  it("filter forms that were moved to GetFilterForm still use it and are not raw GET forms", () => {
    for (const file of USES_GET_FILTER_FORM) {
      const source = read(file);
      expect(source, file).toContain("<GetFilterForm");
      expect(source, file).not.toMatch(/<form\b(?:[^>]|=>)*?\bmethod=(?:"get"|'get'|\{\s*["'`]get["'`]\s*\})/i);
    }
  });

  it("GetFilterForm updates in place: pushes the address with scroll: false and marks the form busy", () => {
    const source = read("components/get-filter-form.tsx");
    expect(source).toContain("useListNavigation");
    expect(source).toContain("aria-busy={pending || undefined}");
    const navigation = read("components/search-as-you-type.tsx");
    expect(navigation).toMatch(/scroll: false/);
  });

  it("adds no new raw GET filter form outside the reviewed list", () => {
    const found = new Map<string, number>();
    for (const file of [...sourceFiles("app"), ...sourceFiles("components")]) {
      if (file === "components/get-filter-form.tsx") continue;
      // Comment lines are left out, so a doc comment that mentions a form is not counted as one.
      const source = read(file).split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join("\n");
      const forms = (source.match(/<(?:form|AutoSubmitForm)\b(?:[^>]|=>)*?\bmethod=(?:"get"|'get'|\{\s*["'`]get["'`]\s*\})/gi) ?? []).length;
      if (forms > 0) found.set(file, forms);
    }
    const unexpected = [...found].filter(([file, count]) => (RAW_GET_FORMS[file]?.forms ?? 0) < count).map(([file]) => file);
    expect(unexpected, "use GetFilterForm (components/get-filter-form.tsx) for a new filter form, or add a reviewed reason to RAW_GET_FORMS").toEqual([]);
    // A reviewed entry that no longer matches is removed, so the list only shrinks.
    const stale = Object.keys(RAW_GET_FORMS).filter((file) => (found.get(file) ?? 0) < RAW_GET_FORMS[file]!.forms);
    expect(stale).toEqual([]);
  });

  it("keeps the browser check for load shift and kept place wired into CI", () => {
    expect(JSON.parse(read("package.json")).scripts["test:keep-place"]).toContain("scripts/verify-keep-place.ts");
    expect(read(".github/workflows/browser-translation.yml")).toContain("npm run test:keep-place");
  });

  it("keeps the banner year box and the masthead role from re-wrapping when the web font swaps in (load shift, B17)", () => {
    const css = read("app/globals.css");
    // The year box is wide enough for "CURRENT CLUB YEAR" in either font, so its width does not change at the swap.
    expect(css).toMatch(/\.club-banner-year \{[^}]*min-width: 11\.5rem/);
    // On a phone the role is its own line under the name, so where the name ends cannot move it (the 0.05 load shift on
    // the coordinator Monthly Records page came from the role re-wrapping after the name, depending on the name's letters).
    expect(css).toMatch(/@media \(max-width: 640px\) \{\s*\.club-masthead-role \{ display: block; \}\s*\.club-masthead-sep \{ display: none; \}/);
    for (const file of ["components/coordinator-masthead-view.tsx", "components/club-portal-masthead-view.tsx"]) {
      expect(read(file), file).toMatch(/className="club-masthead-role"><span className="club-masthead-sep"> · <\/span>/);
    }
  });
});

describe("staff role pills never re-wrap on a phone (#1557, B17)", () => {
  it("gives each admin role pill its own row at phone width", () => {
    const css = readFileSync("app/globals.css", "utf8");
    expect(css).toMatch(/@media \(max-width: 520px\) \{[^}]*\.admin-role-pills \{[^}]*flex-direction: column/);
  });
});

describe("portal masthead buttons never re-wrap on a phone (#1557, B17)", () => {
  it("gives the name its own line so the buttons always start on the next one", () => {
    const css = readFileSync("components/club-portal-masthead-view.module.css", "utf8");
    expect(css).toMatch(/@media \(max-width: 640px\) \{[\s\S]*?\.account > :global\(\.club-masthead-identity\) \{[^}]*flex-basis: 100%/);
    expect(readFileSync("components/portal-masthead-actions.tsx", "utf8")).toMatch(/<div className=\{styles\.account\}>\s*\{identity\}/);
  });
});
