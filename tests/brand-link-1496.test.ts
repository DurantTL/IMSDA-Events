import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Two rules from #1496:
 * 1. Every IMAdventist logo is drawn by the shared `BrandLink`, which links to `/calendar`.
 * 2. Every sign-in page shows the shared "Back to events" link.
 * Source checks, like the other guards: rendering every page would need heavy session mocking.
 */
const root = process.cwd();

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" || entry.name === ".next" ? [] : listFiles(path);
    return entry.isFile() && /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const read = (file: string) => readFileSync(join(root, file), "utf8");

describe("every IMAdventist logo links to the calendar (#1496, #1549)", () => {
  const sourceFiles = [...listFiles(join(root, "app")), ...listFiles(join(root, "components")), ...listFiles(join(root, "modules"))]
    .map((file) => relative(root, file))
    .filter((file) => file !== "components/brand-link.tsx");

  it("has retired the old capital-I mark: no BrandMark component and no mark styles", () => {
    expect(existsSync(join(root, "components/brand-mark.tsx"))).toBe(false);
    const found = sourceFiles.filter((file) => read(file).includes("BrandMark"));
    expect(found, "draw the logo with <BrandLink> (components/brand-link.tsx)").toEqual([]);
    const css = read("app/globals.css");
    expect(css).not.toContain(".brand-mark");
    expect(css).not.toContain(".brand-flame");
  });

  it("has BrandLink render the symbol inside a link to /calendar named IMAdventist calendar", () => {
    const source = read("components/brand-link.tsx");
    expect(source).toContain('BRAND_LINK_HREF = "/calendar"');
    expect(source).toContain("BRAND_LINK_LABEL = BRAND_CALENDAR_LABEL");
    expect(source).toContain("BRAND_LINK_LABEL");
    expect(source).toContain("GuardedLink");
    expect(source).toContain("BRAND_SYMBOL_PATH");
    expect(source).toMatch(/aria-label=\{label \?\? /);
    expect(read("components/brand-link.module.css")).toContain("min-height: 44px");
  });

  it("lets only the public discovery pages send the logo Home (#1561)", () => {
    const source = read("components/brand-link.tsx");
    expect(source).toContain('BRAND_HOME_HREF = "/"');
    expect(source).toContain('destination = "calendar"');
    const homePages = [
      "components/public-home-page.tsx",
      "app/(public)/calendar/page.tsx",
      "app/(public)/clubs/page.tsx",
      "components/public-club-forms-view.tsx",
      "app/(public)/events/page.tsx",
      "app/(public)/events/[eventSlug]/page.tsx",
      "app/(public)/events/[eventSlug]/loading.tsx",
    ];
    const found = sourceFiles.filter((file) => /destination="home"/.test(read(file))).sort();
    expect(found).toEqual([...homePages].sort());
    for (const file of homePages) expect(read(file), file).toContain('destination="home"');
  });

  it("opens the calendar in the top window from the embedded registration pages", () => {
    for (const file of [
      "app/(public)/embed/[eventSlug]/[formSlug]/page.tsx",
      "app/(public)/embed/[eventSlug]/[formSlug]/not-found.tsx",
    ]) {
      expect(read(file), file).toContain('<BrandLink target="_top"');
    }
    expect(read("components/public-registration-form.tsx")).toContain('target={embedded ? "_top" : undefined}');
  });

  it("keeps the unsaved-changes guard on the app shell and both mastheads", () => {
    for (const file of ["components/app-shell.tsx", "components/club-portal-masthead-view.tsx", "components/coordinator-masthead-view.tsx"]) {
      expect(read(file), file).toContain("<BrandLink");
    }
    expect(read("components/app-shell.tsx")).toContain("<BrandLink guarded");
    expect(read("components/brand-link.tsx")).toContain("GuardedLink");
    // Both mastheads rely on the form hook's document-level click listener, which guards any plain link.
    expect(read("components/use-unsaved-changes-guard.ts")).toContain('document.addEventListener("click"');
  });
});

/** Every sign-in page file; the staff two-step challenge is a step of /login, so the page-level link covers it. */
const SIGN_IN_PAGES = [
  "app/login/page.tsx",
  "app/sign-in/page.tsx",
  "app/forgot-password/page.tsx",
  "app/reset-password/page.tsx",
  "app/profile/sign-in/page.tsx",
  "app/(public)/account/sign-in/page.tsx",
  "app/(public)/account/sign-in/code/page.tsx",
  "app/(public)/account/sign-up/page.tsx",
  "app/(public)/account/forgot-password/page.tsx",
  "app/(public)/account/two-step/page.tsx",
  "app/(public)/account/two-step/recover/page.tsx",
  "app/(public)/account/verify-email/page.tsx",
  "app/(public)/staff-invite/[token]/page.tsx",
  // The club-invite acceptance page (/clubs/register/[token]) renders this shared page.
  "components/new-club-application-page.tsx",
];

describe("every sign-in page shows Back to events (#1496)", () => {
  for (const file of SIGN_IN_PAGES) {
    it(`${file} renders the shared back link`, () => {
      expect(read(file)).toContain("<BackToEventsLink");
    });
  }

  it("puts the link on the staff invitation form itself, which the invite page renders", () => {
    expect(read("components/staff-invitation-registration.tsx")).toContain("<BackToEventsLink");
  });

  it("points the shared link at /calendar with the words Back to events", () => {
    const source = read("components/back-to-events-link.tsx");
    expect(source).toContain("BRAND_LINK_HREF");
    expect(source).toContain("Back to events");
    expect(source).toContain("auth-back-link");
    expect(source).toContain("ArrowLeft");
  });
});
