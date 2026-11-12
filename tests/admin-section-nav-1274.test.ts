import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentSession: vi.fn(), resolveAdminRoleView: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/modules/access/admin-roles", () => ({ resolveAdminRoleView: mocks.resolveAdminRoleView }));

import { AdminPageHeader } from "@/components/admin-page-header";
import { AdminSectionHeader } from "@/components/admin-section-header";
import { clubsAdminActiveHref, clubsAdminGroups } from "@/components/staff-navigation";
import { clubSummaryAnchors, clubSummaryHref } from "@/modules/club-reports/club-directory-domain";
import {
  adminBackLink,
  adminSectionFor,
  buildAdminSectionNav,
  type AdminSection,
} from "@/components/admin-section-nav";

/** #1274: the section header's model and its render. Synthetic ids only. */
const org = "org_synthetic";

function nav(section: AdminSection, pathname: string, extra: Partial<Parameters<typeof buildAdminSectionNav>[0]> = {}) {
  return buildAdminSectionNav({ section, pathname, clubYear: "2026-27", eventId: "event_one", ...extra });
}

const marked = (tabs: ReturnType<typeof nav>["tabs"]) => tabs.filter((tab) => tab.current).map((tab) => [tab.key, tab.current]);

describe("which section a page shows", () => {
  const system = { active: "SYSTEM_ADMIN" as const, systemAdmin: true };
  const clubs = { active: "CLUBS_ADMIN" as const, systemAdmin: false };

  it("shows each dashboard's own section", () => {
    expect(adminSectionFor("/admin", system)).toBe("system");
    expect(adminSectionFor("/admin/clubs", system)).toBe("clubs");
    expect(adminSectionFor("/events-admin", { active: "EVENTS_ADMIN", systemAdmin: false })).toBe("events");
  });

  it("shows System on System-only pages", () => {
    for (const path of ["/admin/readiness", "/admin/settings", "/admin/organizations", `/admin/organizations/${org}/billing`, "/admin/event-templates/t1"]) {
      expect(adminSectionFor(path, system), path).toBe("system");
    }
    expect(adminSectionFor("/admin/readiness", clubs)).toBeNull();
  });

  it("shows Clubs on shared club pages only in the Clubs view (or for a Clubs Administrator who is no System administrator)", () => {
    for (const path of ["/admin/clubs/import", "/admin/honors", "/admin/club-supplies", "/admin/club-forms", "/admin/club-forms/k", "/admin/organizations/background-checks", `/admin/organizations/${org}/club`, `/admin/organizations/${org}/profile`, "/admin/people", "/admin/people/staff/u1"]) {
      expect(adminSectionFor(path, { active: "CLUBS_ADMIN", systemAdmin: true }), path).toBe("clubs");
      expect(adminSectionFor(path, system), path).toBe("system");
      expect(adminSectionFor(path, { active: "EVENTS_ADMIN", systemAdmin: false }), path).toBe("clubs");
      expect(adminSectionFor(path, clubs), path).toBe("clubs");
    }
  });

  it("shows Events on event pages only in the Events view, for an event the viewer administers", () => {
    const events = { active: "EVENTS_ADMIN" as const, systemAdmin: false, administersEvent: true };
    for (const path of ["/overview", "/people", "/more/event-content", "/more/kitchen-report", "/communications", "/finance"]) {
      expect(adminSectionFor(path, events), path).toBe("events");
      expect(adminSectionFor(path, { ...events, active: "SYSTEM_ADMIN" }), path).toBeNull();
      expect(adminSectionFor(path, { ...events, administersEvent: false }), path).toBeNull();
    }
  });

  it("shows nothing outside the admin pages", () => {
    expect(adminSectionFor("/check-in", system)).toBeNull();
  });
});

describe("System tabs", () => {
  it("lists the dashboard tabs plus Settings", () => {
    expect(nav("system", "/admin").tabs.map((tab) => tab.label)).toEqual(["Overview", "Events", "Clubs", "People", "Forms", "Settings", "System health"]);
  });

  it("marks Overview as the page on the dashboard and keeps hash tabs as hashes", () => {
    const tabs = nav("system", "/admin").tabs;
    expect(marked(tabs)).toEqual([["overview", "page"]]);
    expect(tabs.find((tab) => tab.key === "events")?.href).toBe("#upcoming-events");
  });

  it("sends hash tabs to the dashboard from any other page", () => {
    const tabs = nav("system", "/admin/people").tabs;
    expect(tabs.find((tab) => tab.key === "events")?.href).toBe("/admin#upcoming-events");
    expect(tabs.find((tab) => tab.key === "health")?.href).toBe("/admin#system-health");
  });

  it("marks a tab's own page as page and a page of its area as true", () => {
    expect(marked(nav("system", "/admin/people").tabs)).toEqual([["people", "page"]]);
    expect(marked(nav("system", "/admin/people/account/a1").tabs)).toEqual([["people", "true"]]);
    expect(marked(nav("system", "/admin/forms").tabs)).toEqual([["forms", "page"]]);
    expect(marked(nav("system", "/admin/information-forms/f1/responses").tabs)).toEqual([["forms", "true"]]);
    expect(marked(nav("system", "/admin/event-templates/t1").tabs)).toEqual([["events", "true"]]);
    expect(marked(nav("system", "/admin/clubs/summary").tabs)).toEqual([["clubs", "page"]]);
    expect(marked(nav("system", "/admin/organizations/directory").tabs)).toEqual([["clubs", "true"]]);
    expect(marked(nav("system", `/admin/organizations/${org}/club/honors`).tabs)).toEqual([["clubs", "true"]]);
    expect(marked(nav("system", "/admin/settings").tabs)).toEqual([["settings", "page"]]);
    expect(marked(nav("system", "/admin/master-award-rules").tabs)).toEqual([["settings", "true"]]);
    expect(marked(nav("system", "/admin/email").tabs)).toEqual([["settings", "true"]]);
    expect(marked(nav("system", "/admin/feature-requests").tabs)).toEqual([["settings", "true"]]);
  });
});

describe("Clubs tabs", () => {
  it("leaves the count off New clubs when the page does not pass one", () => {
    expect(nav("clubs", "/admin/clubs/import").tabs.find((tab) => tab.key === "new-clubs")?.label).toBe("New clubs");
    expect(nav("clubs", "/admin/clubs", { waitingApplications: 3 }).tabs.find((tab) => tab.key === "new-clubs")?.label).toBe("New clubs (3)");
    expect(nav("clubs", "/admin/clubs", { waitingApplications: 0 }).tabs.find((tab) => tab.key === "new-clubs")?.label).toBe("New clubs (0)");
  });

  it("carries the page's club year on the year links", () => {
    const tabs = nav("clubs", "/admin/clubs/reports", { clubYear: "2025-26" }).tabs;
    expect(tabs.find((tab) => tab.key === "all-clubs")?.href).toBe("/admin/clubs/summary?year=2025-26");
  });

  it("marks the tab's own page and its area's other pages", () => {
    expect(marked(nav("clubs", "/admin/clubs").tabs)).toEqual([["overview", "page"]]);
    expect(marked(nav("clubs", "/admin/clubs/summary").tabs)).toEqual([["all-clubs", "page"]]);
    expect(marked(nav("clubs", "/admin/clubs/reports").tabs)).toEqual([["monthly-records", "true"]]);
    expect(marked(nav("clubs", "/admin/clubs/summary", { clubSummaryView: "records" }).tabs)).toEqual([["monthly-records", "true"]]);
    expect(marked(nav("clubs", "/admin/club-forms").tabs)).toEqual([["forms", "page"]]);
    expect(marked(nav("clubs", "/admin/clubs/applications").tabs)).toEqual([["new-clubs", "page"]]);
    expect(marked(nav("clubs", "/admin/clubs/transfers").tabs)).toEqual([["all-clubs", "true"]]);
    expect(marked(nav("clubs", "/admin/clubs/import").tabs)).toEqual([["all-clubs", "true"]]);
    expect(marked(nav("clubs", "/admin/honors").tabs)).toEqual([["all-clubs", "true"]]);
    expect(marked(nav("clubs", "/admin/clubs/reports/year-end").tabs)).toEqual([["monthly-records", "true"]]);
    expect(marked(nav("clubs", `/admin/clubs/reports/${org}/2026-10`).tabs)).toEqual([["monthly-records", "true"]]);
    expect(marked(nav("clubs", "/admin/club-forms/club_form_key").tabs)).toEqual([["forms", "true"]]);
    expect(marked(nav("clubs", "/admin/clubs/invites").tabs)).toEqual([["people", "true"]]);
    expect(marked(nav("clubs", `/admin/organizations/${org}/club`).tabs)).toEqual([["all-clubs", "true"]]);
    expect(marked(nav("clubs", `/admin/organizations/${org}/directors`).tabs)).toEqual([["all-clubs", "true"]]);
    expect(marked(nav("clubs", "/admin/people").tabs)).toEqual([["people", "page"]]);
    expect(marked(nav("clubs", "/admin/people/staff/u1").tabs)).toEqual([["people", "true"]]);
  });
});

describe("Events tabs", () => {
  it("stays on the current event and rewrites My events off the dashboard", () => {
    const tabs = nav("events", "/people").tabs;
    expect(tabs.map((tab) => [tab.key, tab.href])).toEqual([
      ["overview", "/events-admin"],
      ["my-events", "/events-admin#your-events"],
      ["registrations", "/people?event=event_one"],
      ["schedule", "/more/event-content?event=event_one"],
      ["kitchen", "/more/kitchen-report?event=event_one"],
      ["messages", "/communications?event=event_one"],
    ]);
    expect(nav("events", "/events-admin", { eventId: "event_two" }).tabs[1].href).toBe("#your-events");
  });

  it("marks the page's own tab, and My events for the dashboard page", () => {
    expect(marked(nav("events", "/events-admin").tabs)).toEqual([["overview", "page"]]);
    expect(marked(nav("events", "/people").tabs)).toEqual([["registrations", "page"]]);
    expect(marked(nav("events", "/more/event-content").tabs)).toEqual([["schedule", "page"]]);
    expect(marked(nav("events", "/more/kitchen-report").tabs)).toEqual([["kitchen", "page"]]);
    expect(marked(nav("events", "/communications").tabs)).toEqual([["messages", "page"]]);
    expect(marked(nav("events", "/overview").tabs)).toEqual([["my-events", "true"]]);
    expect(marked(nav("events", "/finance").tabs)).toEqual([]);
  });

  it("draws no back link on an event page", () => {
    for (const path of ["/events-admin", "/people", "/overview", "/finance", "/communications"]) expect(nav("events", path).back, path).toBeUndefined();
  });
});

describe("back links", () => {
  it("keeps a club page's way back inside the Clubs view", () => {
    expect(adminBackLink("clubs", `/admin/organizations/${org}/club`)).toEqual({ href: "/admin/clubs/summary", label: "Back to Club summary" });
    for (const path of ["/admin/clubs/import", "/admin/clubs/invites", "/admin/clubs/health-import"]) {
      expect(adminBackLink("clubs", path), path).toEqual({ href: "/admin/clubs/summary", label: "Back to Club summary" });
    }
  });

  it("sends the System view to Clubs and churches", () => {
    expect(adminBackLink("system", `/admin/organizations/${org}/club`)).toEqual({ href: "/admin/organizations", label: "Back to Clubs and churches" });
    expect(adminBackLink("system", "/admin/clubs/invites")).toEqual({ href: "/admin/organizations", label: "Back to Clubs and churches" });
    // The club imports belong to the Club directory in both views (#1589).
    for (const path of ["/admin/clubs/import", "/admin/clubs/health-import"]) {
      expect(adminBackLink("system", path), path).toEqual({ href: "/admin/clubs/summary", label: "Back to Club summary" });
    }
  });

  it("sends directors and profile back to the club in the Clubs view, and to Clubs and churches in System unless the visitor came from the club", () => {
    for (const leaf of ["directors", "profile"]) {
      const path = `/admin/organizations/${org}/${leaf}`;
      expect(adminBackLink("clubs", path, { parentName: "Example Pathfinders" })).toEqual({ href: `/admin/organizations/${org}/club`, label: "Back to Example Pathfinders" });
      expect(adminBackLink("system", path)).toEqual({ href: "/admin/organizations", label: "Back to Clubs and churches" });
      expect(adminBackLink("system", path, { viaParent: true, parentName: "Example Pathfinders" })).toEqual({ href: `/admin/organizations/${org}/club`, label: "Back to Example Pathfinders" });
    }
    expect(adminBackLink("clubs", `/admin/organizations/${org}/club/honors`, { parentName: "Example Pathfinders" })).toEqual({ href: `/admin/organizations/${org}/club`, label: "Back to Example Pathfinders" });
  });

  it("goes back to the club from a Monthly Record only when the visitor came from it", () => {
    expect(adminBackLink("clubs", `/admin/clubs/reports/${org}/2026-10`)).toEqual({ href: "/admin/clubs/reports", label: "Back to Review monthly records" });
    expect(adminBackLink("clubs", `/admin/clubs/reports/${org}/2026-10`, { viaParent: true, parentName: "Sample Club" })).toEqual({ href: `/admin/organizations/${org}/club`, label: "Back to Sample Club" });
    expect(adminBackLink("clubs", "/admin/clubs/reports/year-end")?.href).toBe("/admin/clubs/reports");
  });

  it("returns from the review list to the Monthly Records tab (#1552)", () => {
    expect(adminBackLink("clubs", "/admin/clubs/reports", { clubYear: "2025-26" })).toEqual({ href: "/admin/clubs/summary?year=2025-26&view=records#monthly-records", label: "Back to Monthly Records" });
  });

  it("makes the menu link and the summary tab the same destination (#1552)", () => {
    const menu = clubsAdminGroups.flatMap((group) => group.items).find((item) => item.label === "Monthly Records")!;
    const tab = nav("clubs", "/admin/clubs").tabs.find((candidate) => candidate.key === "monthly-records")!;
    const parts = (href: string) => { const url = new URL(href, "https://example.test"); return [url.pathname, url.searchParams.get("view"), url.hash]; };
    expect(parts(menu.href)).toEqual(["/admin/clubs/summary", "records", "#monthly-records"]);
    expect(parts(tab.href)).toEqual(parts(menu.href));
    // The summary page's own Monthly Records tab link is `?year=…&view=records#monthly-records`.
    expect(parts(clubSummaryHref({ clubYear: "2025-26", view: "records" }) + "#" + clubSummaryAnchors.records)).toEqual(parts(menu.href));
    expect(clubsAdminActiveHref("/admin/clubs/summary", "records")).toBe(menu.href);
  });

  it("adds the missing System back links", () => {
    expect(adminBackLink("system", "/admin/event-templates/t1")).toEqual({ href: "/admin/event-templates", label: "Back to Event templates" });
    expect(adminBackLink("system", "/admin/information-forms/f1/responses", { parentName: "Camp survey" })).toEqual({ href: "/admin/information-forms", label: "Back to information forms" });
    expect(adminBackLink("system", "/admin/information-forms/f1")).toEqual({ href: "/admin/information-forms", label: "Back to information forms" });
    expect(adminBackLink("system", "/admin/form-templates/key")?.href).toBe("/admin/form-templates");
    expect(adminBackLink("clubs", "/admin/club-forms/key")?.href).toBe("/admin/club-forms");
  });

  it("draws none on a main page", () => {
    for (const path of ["/admin", "/admin/people", "/admin/organizations", "/admin/clubs", "/admin/clubs/summary", "/admin/clubs/applications", "/admin/club-forms", "/admin/event-templates"]) {
      expect(adminBackLink("system", path), path).toBeNull();
    }
  });

  it("lets a page replace or drop the link", () => {
    expect(nav("clubs", "/admin/clubs/import", { back: null }).back).toBeUndefined();
    expect(nav("clubs", "/admin/clubs/import", { back: { href: "/x", label: "Back to x" } }).back).toEqual({ href: "/x", label: "Back to x" });
  });
});

describe("the rendered header", () => {
  const render = (model: ReturnType<typeof nav>) => renderToStaticMarkup(createElement(AdminSectionHeader, { nav: model }));

  it("names the section and leaves the tab row to the shell, while the model still marks page and true", () => {
    const html = render(nav("system", "/admin/people/staff/u1"));
    expect(html).toContain("System administration");
    // The area's one row of tabs is the shell's (#1565); the page header does not draw it a second time.
    expect(html).not.toContain('aria-label="System administration sections"');
    expect(html).not.toContain("<li>");
    const model = nav("system", "/admin/people/staff/u1");
    expect(model.navLabel).toBe("System administration sections");
    expect(model.tabs.find((tab) => tab.key === "people")?.current).toBe("true");
    expect(nav("system", "/admin/people").tabs.find((tab) => tab.key === "people")?.current).toBe("page");
  });

  it("draws the back link as a plain link to the parent, and none on a main page", () => {
    const deeper = render(nav("clubs", "/admin/clubs/import"));
    expect(deeper).toMatch(/<a [^>]*href="\/admin\/clubs\/summary"[^>]*>.*Back to Club summary</);
    expect(deeper).not.toContain("history.back");
    expect(deeper.match(/Back to/g)).toHaveLength(1);
    expect(render(nav("clubs", "/admin/clubs/summary"))).not.toContain("Back to");
  });
});

describe("the page header picks the section from the viewer's active role", () => {
  const view = (active: string, roles: Partial<{ systemAdmin: boolean; clubsAdministrator: boolean; eventAdminEventIds: string[] }>) => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: `user_${active}_${Object.keys(roles).join("")}`, globalRole: roles.systemAdmin ? "SYSTEM_ADMIN" : "STAFF" } });
    mocks.resolveAdminRoleView.mockResolvedValue({ roles: { systemAdmin: false, clubsAdministrator: false, eventAdminEventIds: [], ...roles }, held: [], active });
  };
  const html = async (props: Parameters<typeof AdminPageHeader>[0]) => {
    const element = await AdminPageHeader(props);
    return element ? renderToStaticMarkup(element) : "";
  };

  it("shows the Clubs header on a shared club page in the Clubs view and the System header in the System view", async () => {
    view("CLUBS_ADMIN", { systemAdmin: true });
    const clubsHtml = await html({ path: "/admin/clubs/import" });
    expect(clubsHtml).toContain("Club administration");
    expect(clubsHtml).toContain('href="/admin/clubs/summary"');
    view("SYSTEM_ADMIN", { systemAdmin: true });
    const systemHtml = await html({ path: "/admin/clubs/import" });
    expect(systemHtml).toContain("System administration");
    expect(systemHtml).toContain('href="/admin/clubs/summary"');
    expect(systemHtml).toContain("Back to Club summary");
  });

  it("shows the Events header on an event page only to an Events Administrator of that event", async () => {
    view("EVENTS_ADMIN", { eventAdminEventIds: ["event_one"] });
    expect(await html({ path: "/people", eventId: "event_one" })).toContain("Event administration");
    expect(await html({ path: "/people", eventId: "event_other" })).toBe("");
    view("SYSTEM_ADMIN", { systemAdmin: true, eventAdminEventIds: ["event_one"] });
    expect(await html({ path: "/people", eventId: "event_one" })).toBe("");
  });
});
