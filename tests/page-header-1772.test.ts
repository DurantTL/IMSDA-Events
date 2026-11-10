import { createElement as createTypedElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import ArchivedEventsPage from "@/app/archived-events/page";
import { AdminHub } from "@/components/admin-hub";
import { AdminSectionHeaderFor } from "@/components/admin-section-header";
import { PageHeader } from "@/components/page-header";
import { DetailPage } from "@/components/page-templates/detail-page";
import { FormPage } from "@/components/page-templates/form-page";
import { HubPage } from "@/components/page-templates/hub-page";
import { ListPage } from "@/components/page-templates/list-page";
import { StepPage, stepLine } from "@/components/page-templates/step-page";
import { OwnHeaderState } from "@/components/own-header-state";
import { StaffPageHeader } from "@/components/staff-page-header";
import { drawsH1, root, source, staffReach } from "./helpers/page-sources-1772";

const navigation = vi.hoisted(() => ({ path: "/x" }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.path, useRouter: () => ({ push: vi.fn() }), redirect: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: async () => ({ user: { id: "user_1", email: "staff@example.test", globalRole: "SYSTEM_ADMIN" } }) }));
vi.mock("@/modules/access/login-redirect", () => ({ staffLoginRedirectPath: async () => "/login" }));
vi.mock("@/modules/events/archive-repository", () => ({
  listArchivedEventsForUser: async () => [{ id: "evt_1", name: "Sample archived event", startsAt: new Date("2025-06-01T15:00:00Z"), endsAt: new Date("2025-06-02T15:00:00Z"), timezone: "America/Chicago" }],
}));

// A loosely typed createElement: the templates take their sections as children, which the strict overloads reject here.
const createElement = createTypedElement as unknown as (type: unknown, props?: unknown, ...children: unknown[]) => ReactElement;

// #1772, site rules D1 to D4: one PageHeader, title once, one filled main action, actions under the title on a phone. Synthetic data only.
const html = (element: ReactElement) => renderToStaticMarkup(element);
const count = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;
const primary = createElement("a", { className: "primary-button", href: "/go" }, "Go");
const secondary = createElement("a", { className: "secondary-button", href: "/other" }, "Other");

describe("the title look is one source (#1772)", () => {
  const read = (file: string) => readFileSync(join(root, file), "utf8");
  const block = (css: string, selector: string) => new RegExp(`${selector.replace(".", "\\.")} \\{([^}]*)\\}`).exec(css)?.[1] ?? "";

  it("gives the title the staff title's weight, spacing, size steps and colour", () => {
    const css = read("components/page-header.module.css");
    const title = block(css, ".title");
    expect(title).toContain("font-weight: 800");
    expect(title).toContain("letter-spacing: -0.02em");
    expect(title).toContain("clamp(1.35rem, 2vw, 1.7rem)");
    expect(title).toContain("color: var(--ink)");
    expect(title).toContain("line-height: 1.2");
    expect(css).toMatch(/@media \(max-width: 800px\) \{\s*\.title \{[^}]*1\.18rem/);
  });

  it("makes the shell's own title compose it, with no second set of title rules", () => {
    const shell = read("components/staff-shell.module.css");
    expect(shell).toContain('.pageTitle { composes: title from "./page-header.module.css"; }');
    expect(shell).not.toMatch(/\.pageHeader h1/);
    expect(source("components/app-shell.tsx")).toContain("<h1 className={styles.pageTitle}>");
  });
});

describe("the states that replace a page keep its one h1 (#1772)", () => {
  it("draws the title for a page that owns its header, and nothing for any other", () => {
    navigation.path = "/more/clubs/org_1";
    const owned = html(createElement(OwnHeaderState));
    expect(count(owned, /<h1\b/g)).toBe(1);
    expect(owned).toContain(">Club</h1>");
    navigation.path = "/more/clubs/reports";
    expect(html(createElement(OwnHeaderState))).toBe("");
    navigation.path = "/overview";
    expect(html(createElement(OwnHeaderState))).toBe("");
    navigation.path = "/x";
  });

  it("is drawn by the not-found, error and loading views of the workspace", () => {
    for (const file of ["app/(workspace)/not-found.tsx", "app/(workspace)/error.tsx", "app/(workspace)/loading.tsx"]) {
      expect(source(file), file).toContain("<OwnHeaderState />");
    }
  });
});

describe("migrated pages carry a real header action (#1772)", () => {
  it("puts /archived-events' Back to events link in the header, once, as the outlined button", async () => {
    const markup = html(await ArchivedEventsPage());
    expect(count(markup, /Back to events/g)).toBe(1);
    expect(markup.indexOf("Back to events")).toBeGreaterThan(markup.indexOf("<h1"));
    expect(markup.indexOf("Back to events")).toBeLessThan(markup.indexOf("Sample archived event"));
    expect(markup).toMatch(/page-header-actions[^>]*>\s*<a class="secondary-button" href="\/admin">Back to events/);
    expect(count(markup, /primary-button/g)).toBe(0);
  });

  it("keeps /select-event's Archived events link in the header under the same condition", () => {
    const page = source("app/select-event/page.tsx");
    expect(page).toContain("secondary: archivedEvents.length > 0");
  });
});

describe("PageHeader (#1772)", () => {
  it("draws one h1, the one-sentence description, an eyebrow and the actions in the approved order", () => {
    const markup = html(createElement(PageHeader, { title: "Lodging requests", description: "What guests asked for.", eyebrow: "Step 2 of 3", primary, secondary }));
    expect(count(markup, /<h1\b/g)).toBe(1);
    expect(markup).toContain("Lodging requests</h1>");
    expect(markup).toContain("What guests asked for.");
    expect(markup).toContain("Step 2 of 3");
    expect(markup.indexOf("Go")).toBeLessThan(markup.indexOf("Other"));
    expect(markup).toContain("page-header-actions");
  });

  it("draws one back link above the title and none when the page has none", () => {
    const withBack = html(createElement(PageHeader, { title: "Permission slip", back: { href: "/admin/club-forms", label: "Back to club forms" } }));
    expect(count(withBack, /Back to club forms/g)).toBe(1);
    expect(withBack.indexOf("Back to club forms")).toBeLessThan(withBack.indexOf("<h1"));
    expect(html(createElement(PageHeader, { title: "Roster" }))).not.toContain("more-back-link");
  });

  it("keeps a club's name out of the translator", () => {
    expect(html(createElement(PageHeader, { title: "Sample club", exactName: true }))).toContain('translate="no"');
  });

  it("draws the actions in a Tools menu without a heading of its own", () => {
    const markup = html(createElement(PageHeader, { title: "Roster", tools: [{ href: "/a", label: "Tool A" }] }));
    expect(markup).toContain("Tool A");
    expect(count(markup, /<h[1-6]\b/g)).toBe(1);
  });

  it("drops the actions under the title below 640px, full width", () => {
    const css = readFileSync(join(root, "components/page-header.module.css"), "utf8");
    expect(css).toMatch(/@media \(max-width: 639px\)[\s\S]*\.actions \{[^}]*width: 100%/);
    expect(css).toMatch(/\.actions > :is\(a, button\) \{[^}]*min-height: 44px/);
  });
});

describe("the older header parts render through PageHeader (#1772)", () => {
  it("StaffPageHeader keeps its classes and draws no heading", () => {
    const markup = html(createElement(StaffPageHeader, { description: "One sentence.", primary }));
    expect(markup).toContain('class="staff-page-header"');
    expect(markup).toContain('class="staff-page-description"');
    expect(markup).toContain('class="staff-page-actions"');
    expect(markup).not.toMatch(/<h[1-6]/);
    expect(html(createElement(StaffPageHeader, {}))).toBe("");
  });

  it("AdminSectionHeader keeps its test id, section and eyebrow and draws no heading", () => {
    const markup = html(createElement(AdminSectionHeaderFor, { section: "system", path: "/admin/organizations" }));
    expect(markup).toContain('data-testid="admin-section-header"');
    expect(markup).toContain('data-section="system"');
    expect(markup).toContain("eyebrow");
    expect(markup).not.toMatch(/<h[1-6]/);
  });

  it("both go through PageHeader in the source, so there is one place to change", () => {
    expect(source("components/staff-page-header.tsx")).toContain("<PageHeader");
    expect(source("components/admin-section-header.tsx")).toContain("<PageHeader");
  });
});

describe("the five page templates (#1772)", () => {
  const header = { title: "Things", description: "All the things." };
  const slice = { from: 1, page: 1, pageCount: 2, to: 25, total: 40 };

  it("ListPage: header, filters, list and the shared pager", () => {
    const markup = html(createElement(ListPage, { header, filters: createElement("p", null, "FILTERS"), pager: { label: "Things pages", noun: "things", slice, hrefFor: (page: number) => `/things?page=${page}` } }, createElement("ul", null, createElement("li", null, "ROW"))));
    expect(count(markup, /<h1\b/g)).toBe(1);
    expect(markup.indexOf("FILTERS")).toBeLessThan(markup.indexOf("ROW"));
    expect(markup).toContain("Showing 1–25 of 40 things");
    expect(markup).toContain('data-page-template="list"');
  });

  it("DetailPage: one back link, header, then the sections", () => {
    const markup = html(createElement(DetailPage, { header: { ...header, back: { href: "/things", label: "Back to things" } } }, createElement("section", null, "SECTION")));
    expect(count(markup, /Back to things/g)).toBe(1);
    expect(markup.indexOf("<h1")).toBeLessThan(markup.indexOf("SECTION"));
  });

  it("FormPage: header, the fields, then the save bar slot", () => {
    const markup = html(createElement(FormPage, { header, saveBar: createElement("div", { className: "event-savebar" }, "Saved") }, createElement("form", null, "FIELDS")));
    expect(markup.indexOf("FIELDS")).toBeLessThan(markup.indexOf("Saved"));
    expect(count(markup, /<h1\b/g)).toBe(1);
  });

  it("HubPage: the hub's sentence and one action sit in the header, and the hub keeps its cards without a second intro", () => {
    const view = {
      key: "sample",
      description: "Where the things are.",
      action: { href: "/things/new", label: "Add a thing" },
      stats: [],
      groups: [{ title: "Group", cards: [{ href: "/things/a", title: "Thing A", description: "About A.", status: null }] }],
    };
    const markup = html(createElement(HubPage, { title: "Things", view }));
    expect(count(markup, /<h1\b/g)).toBe(1);
    expect(count(markup, /Where the things are\./g)).toBe(1);
    expect(count(markup, /data-testid="hub-action"/g)).toBe(1);
    expect(markup).toContain("primary-button");
    expect(markup).toContain('data-testid="hub-card"');
    // The hub on its own still draws its intro.
    expect(html(createElement(AdminHub, { view }))).toContain('data-testid="hub-action"');
  });

  it("StepPage: the step line is the eyebrow, and a flow with no known step draws none", () => {
    expect(stepLine({ number: 2, total: 3, label: "Each person's details" })).toBe("Step 2 of 3 · Each person's details");
    const stepped = html(createElement(StepPage, { header, step: { number: 1, total: 2, label: "Choose" }, footer: createElement("p", null, "NEXT") }, createElement("p", null, "STEP")));
    expect(stepped).toContain("Step 1 of 2 · Choose");
    expect(stepped.indexOf("STEP")).toBeLessThan(stepped.indexOf("NEXT"));
    expect(html(createElement(StepPage, { header }, "x"))).not.toContain("eyebrow");
  });

  it("each template has its README section and is used by a real page", () => {
    const readme = readFileSync(join(root, "components/page-templates/README.md"), "utf8");
    for (const name of ["ListPage", "DetailPage", "FormPage", "HubPage", "StepPage"]) {
      expect(readme, name).toContain(`**${name}**`);
      const users = [...staffReach()].filter((file) => file.startsWith("app/") && source(file).includes(`<${name}`));
      expect(users.length, `${name} is used by a page`).toBeGreaterThan(0);
    }
  });
});

describe("no staff page draws an h1 outside PageHeader (#1772, rule D1)", () => {
  const exceptions: { files: Record<string, string> } = JSON.parse(readFileSync(join(root, "tests/fixtures/h1-exceptions-1772.json"), "utf8"));
  const listed = Object.keys(exceptions.files);
  const found = [...staffReach()].filter((file) => file !== "components/page-header.tsx" && drawsH1(file)).sort();

  it("fails for any new file with an h1", () => {
    expect(found.filter((file) => !listed.includes(file))).toEqual([]);
  });

  it("fails when a reviewed exception no longer has an h1, so the list only shrinks", () => {
    expect(listed.filter((file) => !found.includes(file))).toEqual([]);
  });

  it("keeps the shell's own h1 as one reviewed exception", () => {
    expect(listed).toContain("components/app-shell.tsx");
    expect(Object.values(exceptions.files).every((reason) => reason.length > 10)).toBe(true);
  });

  it("draws the h1 in PageHeader", () => {
    expect(drawsH1("components/page-header.tsx")).toBe(true);
  });
});
