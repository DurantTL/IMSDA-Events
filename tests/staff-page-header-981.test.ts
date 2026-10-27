import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { StaffPageHeader } from "@/components/staff-page-header";
import { buildMoreDirectoryCards, navigation } from "@/components/staff-navigation";
import { systemNavGroups } from "@/components/system-navigation";

// Issue #981 batch 2: one page header, no copied back buttons, no chip bars that copy the sidebar or More.
// Synthetic data only. Source checks guard the markup a server page would draw; the rendered check is the mobile audit.
const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

describe("the shared staff page header", () => {
  it("draws a description and one primary action, with no heading of its own (the topbar owns the h1)", () => {
    const markup = renderToStaticMarkup(createElement(StaffPageHeader, {
      description: "One sentence.",
      primary: createElement("a", { className: "primary-button", href: "/x" }, "Do it"),
    }));
    expect(markup).toContain('class="staff-page-description"');
    expect(markup).toContain("Do it");
    expect(markup).not.toMatch(/<h[1-6]/);
    expect(markup).not.toContain("eyebrow");
  });

  it("folds sub-page links into one Tools menu, and secondary work into one Actions menu", () => {
    const markup = renderToStaticMarkup(createElement(StaffPageHeader, {
      actions: createElement("li", null, createElement("a", { href: "/export" }, "Export")),
      tools: [{ href: "/a", label: "Tool A" }, { href: "/b", label: "Tool B" }],
    }));
    expect(markup.match(/class="actions-menu"/g)).toHaveLength(2);
    expect(markup).toContain("Actions");
    expect(markup).toContain("Tools");
    for (const text of ["/export", "Tool A", "Tool B", 'href="/a"', 'href="/b"']) expect(markup).toContain(text);
  });

  it("renders nothing for a page with no description, action or tool", () => {
    expect(renderToStaticMarkup(createElement(StaffPageHeader, {}))).toBe("");
  });
});

describe("back buttons that repeat the sidebar or More are gone", () => {
  const sidebarEntryPages = [
    "app/(workspace)/admin/readiness/page.tsx", "app/(workspace)/admin/people/page.tsx", "app/(workspace)/admin/settings/page.tsx",
    "app/(workspace)/admin/club-forms/page.tsx", "app/(workspace)/admin/club-supplies/page.tsx", "app/(workspace)/admin/master-award-rules/page.tsx",
    "app/(workspace)/admin/honors/page.tsx", "app/(workspace)/admin/calendar/page.tsx",
    "app/(workspace)/admin/organizations/page.tsx", "app/(workspace)/admin/clubs/summary/page.tsx", "app/(workspace)/admin/clubs/reports/page.tsx",
    "app/(workspace)/admin/clubs/transfers/page.tsx", "app/(workspace)/admin/clubs/applications/page.tsx", "app/(workspace)/admin/organizations/background-checks/page.tsx",
  ];

  it("has no Back to system administration or Back to Clubs and churches on a page the system sidebar lists", () => {
    for (const file of sidebarEntryPages) {
      const source = read(file);
      expect(source, file).not.toContain("Back to system administration");
      expect(source, file).not.toContain("Back to Clubs and churches");
    }
    // The sidebar keeps the destinations those buttons led to.
    const hrefs = systemNavGroups.flatMap((group) => group.items.map((item) => item.href));
    expect(hrefs).toContain("/admin/organizations");
  });

  it("keeps a back link on admin sub-pages that have no sidebar entry, through the shared BackLink", () => {
    for (const file of [
      "app/(workspace)/admin/clubs/import/page.tsx", "app/(workspace)/admin/clubs/invites/page.tsx", "app/(workspace)/admin/organizations/directory/page.tsx",
      "app/(workspace)/admin/organizations/import/page.tsx", "app/(workspace)/admin/club-forms/[templateKey]/page.tsx",
    ]) {
      const source = read(file);
      expect(source, file).toContain("<BackLink");
      expect(source, file).not.toContain("more-back-link");
    }
  });

  it("has no Back to More or Back to Registrations on pages More and the sidebar already reach", () => {
    for (const file of [
      "app/(workspace)/more/team-results/page.tsx", "app/(workspace)/more/merchandise/page.tsx", "app/(workspace)/more/event-health/page.tsx",
      "app/(workspace)/more/event-patches/page.tsx", "app/(workspace)/more/event-content/page.tsx", "app/(workspace)/more/clubs/page.tsx",
      "app/(workspace)/more/health/page.tsx", "app/(workspace)/more/club-assignments/page.tsx", "app/(workspace)/more/club-forms/page.tsx",
      "app/(workspace)/more/honors/page.tsx", "app/(workspace)/more/promo-codes/page.tsx", "components/program-assignments-workspace.tsx",
      "app/(workspace)/people/attendees/page.tsx", "app/(workspace)/people/staff-invitations/page.tsx", "app/(workspace)/people/directory-review/page.tsx",
      "app/(workspace)/people/pending-teams/page.tsx", "app/(workspace)/people/duplicates/page.tsx",
    ]) {
      const source = read(file);
      expect(source, file).not.toContain("Back to More");
      expect(source, file).not.toContain("Back to Registrations");
    }
    // More and Registrations are still one click away: More is a sidebar item and a phone tab, Registrations too.
    expect(navigation.some((item) => item.href === "/more" && item.label === "More")).toBe(true);
    expect(navigation.some((item) => item.href === "/people" && item.sidebar === "daily")).toBe(true);
  });
});

describe("link-chip bars became one Tools menu without losing a destination", () => {
  it("/admin/organizations keeps the links the system sidebar does not list, and drops the ones it does", () => {
    const source = read("app/(workspace)/admin/organizations/page.tsx");
    const sidebar = new Set(systemNavGroups.flatMap((group) => group.items.map((item) => item.href)));
    for (const href of ["/admin/clubs/import", "/admin/clubs/health-import", "/admin/organizations/directory", "/admin/organizations/import", "/admin/clubs/invites"]) {
      expect(source, href).toContain(href);
      // Not a sidebar item (Club invites is reached through "New club applications and invites" only for its highlight).
      expect(sidebar.has(href), href).toBe(false);
    }
    for (const href of ["/admin/clubs/applications", "/admin/clubs/reports", "/admin/clubs/summary", "/admin/clubs/transfers", "/admin/organizations/background-checks"]) {
      expect(source, href).not.toContain(`"${href}"`);
      expect(sidebar.has(href), href).toBe(true);
    }
    expect(source).not.toContain("club-admin-links");
  });

  it("/finance folds all eight links into the Tools menu", () => {
    const source = read("components/finance-workspace.tsx");
    for (const path of [
      "/finance/church-owed", "/finance/billing-responsibility", "/finance/attendance-reconciliation", "/finance/scholarship-fund",
      "/finance/invoices", "/more/promo-codes", "/finance/cancellation-policy", "/finance/square-payments",
    ]) expect(source, path).toContain(`\`${path}?event=`);
    expect(source).not.toContain("page-intro-actions");
    expect(source).toContain("tools={[");
  });

  it("/more/reports folds its report links into Tools and its two downloads into Actions", () => {
    const source = read("app/(workspace)/more/reports/page.tsx");
    for (const path of ["/more/reports/packets", "/more/reports/clubs", "/more/reports/clubs/check-in-book", "/more/honors/rosters", "/more/kitchen-report"]) {
      expect(source, path).toContain(`\`${path}\${peopleQuery}\``);
    }
    for (const path of ["exports/meal-tickets", "exports/meal-ticket-summary"]) expect(source, path).toContain(path);
    expect(source).not.toContain("report-actions");
  });

  it("/more/honors keeps the Schedule board, Rosters and Instructors, and /check-in keeps its three print and issue links", () => {
    const honors = read("components/honors-setup-workspace.tsx");
    for (const path of ["/more/honors/schedule", "/more/honors/rosters", "/more/honors/instructors"]) expect(honors, path).toContain(path);
    const checkIn = read("components/check-in-workspace.tsx");
    for (const path of ["/check-in/passes", "/check-in/badges", "/check-in/assets"]) expect(checkIn, path).toContain(`\`${path}?event=`);
    expect(checkIn).not.toContain("checkin-print-links");
  });
});

describe("/overview", () => {
  const source = read("app/(workspace)/overview/page.tsx");

  it("drops the quick links that repeat the sidebar and the Registrations header, keeping the update shortcut", () => {
    for (const label of ["Find a person", "Start registration", "Review finances", "Open check-in"]) expect(source, label).not.toContain(label);
    expect(source).toContain("Draft an update");
  });

  it("leaves a gap between the setup card and the stat row", () => {
    expect(read("app/globals.css")).toMatch(/\.setup-checklist \{ margin-bottom: 20px; \}/);
  });

  it("keeps every dropped destination one click away: Registrations, Payments and Check-in are sidebar items", () => {
    const sidebar = navigation.filter((item) => item.sidebar === "daily").map((item) => item.href);
    for (const href of ["/people", "/finance", "/check-in"]) expect(sidebar).toContain(href);
    // Start registration stays on the Registrations header (its button checks canEdit, MANAGE_REGISTRATION, and not the event's archived state).
    expect(read("components/people-workspace.tsx")).toContain("Start registration");
  });
});

describe("the More cards still reach every page whose back button went", () => {
  it("lists a card for each /more tool page that lost 'Back to More'", () => {
    const cards = buildMoreDirectoryCards({
      permissions: ["CONFIGURE_EVENT", "MANAGE_FINANCE", "MANAGE_STAFF", "MANAGE_REGISTRATION", "MANAGE_COMMUNICATIONS", "VIEW_REPORTS", "VIEW_SENSITIVE_DATA", "VIEW_HEALTH_INFORMATION", "MANAGE_FORMS", "MANAGE_IMPORTS"],
      clubOversight: true,
      clubEvent: true,
      isSystemAdmin: true,
      clubFormsAccess: true,
      eventQuery: "",
    });
    const hrefs = cards.map((card) => card.href);
    for (const href of ["/more/merchandise", "/more/event-health", "/more/event-patches", "/more/event-content", "/more/clubs", "/more/club-assignments", "/more/club-forms", "/more/honors", "/more/promo-codes", "/more/program-assignments", "/more/health", "/staff"]) {
      expect(hrefs, href).toContain(href);
    }
  });
});

describe("operational guidance kept after the header change", () => {
  it("keeps the Accounts two-step and forgotten-password guidance as helper text (now on the person page)", () => {
    const source = read("components/person-access.tsx");
    expect(source).toContain("Nobody can turn it off themselves.");
    expect(source).toContain("Forgotten passwords are reset by the person with");
    expect(source).toContain("Every action here is recorded.");
    expect(source).toMatch(/className="field-help"/);
  });

  it("draws the Sterling Volunteers intro through the shared header, beside the import panel", () => {
    const source = read("app/(workspace)/admin/organizations/background-checks/page.tsx");
    expect(source).toContain("<StaffPageHeader");
    expect(source).toContain("primary={<BackgroundCheckImportPanel />}");
    expect(source).not.toContain("page-intro");
  });
});
