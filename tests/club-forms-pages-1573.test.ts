import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clubFormsViews } from "@/components/club-forms-views";
import { staffPlaceFor } from "@/components/staff-areas";
import { buildStaffNavigation } from "@/components/staff-navigation-model";

// #1573: the club forms pages are one Forms section (Definitions, Submissions, Missing forms). Synthetic data only.
const root = join(__dirname, "..");
const read = (file: string) => readFileSync(join(root, file), "utf8");
const definitions = read("app/(workspace)/admin/club-forms/page.tsx");
const builder = read("app/(workspace)/admin/club-forms/[templateKey]/page.tsx");
const submissions = read("app/(workspace)/more/club-forms/page.tsx");
const submission = read("app/(workspace)/more/club-forms/[submissionId]/page.tsx");
const missingList = read("components/clubs-forms-missing-list.tsx");
const labels = (views: Array<{ label: string }>) => views.map((view) => view.label);

describe("the club forms views (#1573)", () => {
  it("gives a Clubs administrator all three views in order, each at its own page", () => {
    const views = clubFormsViews({ administration: true });
    expect(views.map(({ label, href }) => [label, href])).toEqual([
      ["Definitions", "/admin/club-forms"],
      ["Submissions", "/more/club-forms"],
      ["Missing forms", "/admin/club-forms?view=missing"],
    ]);
  });

  it("gives a viewer with only Submissions one view, which the strip hides", () => {
    const views = clubFormsViews({ administration: false }, "submissions");
    expect(labels(views)).toEqual(["Submissions"]);
    expect(views.length).toBeLessThan(2);
  });

  it("marks only the current view", () => {
    for (const current of ["definitions", "submissions", "missing"] as const) {
      const marked = clubFormsViews({ administration: true }, current).filter((view) => view.current);
      expect(marked.map((view) => view.key)).toEqual([current]);
    }
    expect(clubFormsViews({ administration: true }).some((view) => view.current)).toBe(false);
  });

  it("keeps the year on Missing forms and the event on Submissions only when the page has one", () => {
    const views = clubFormsViews({ administration: true }, "missing", { year: "2026-27", event: "event_1" });
    expect(views.find((view) => view.key === "missing")!.href).toBe("/admin/club-forms?view=missing&year=2026-27");
    expect(views.find((view) => view.key === "submissions")!.href).toBe("/more/club-forms?event=event_1");
    expect(views.find((view) => view.key === "definitions")!.href).toBe("/admin/club-forms");
  });
});

describe("where the submissions pages sit in the shell (#1573)", () => {
  it("puts them in Admin, Forms when the URL has no event", () => {
    for (const path of ["/more/club-forms", "/more/club-forms/sub_1"]) {
      expect(staffPlaceFor(path)).toEqual({ area: "admin", tab: "hub-forms", view: "/admin/club-forms", inEvent: false });
      expect(staffPlaceFor(path, new URLSearchParams("form=medical"))).toMatchObject({ area: "admin", tab: "hub-forms", inEvent: false });
    }
  });

  it("keeps them in the event shell when the URL carries an event", () => {
    for (const path of ["/more/club-forms", "/more/club-forms/sub_1"]) {
      expect(staffPlaceFor(path, new URLSearchParams("event=event_1"))).toEqual({ area: "events", tab: null, view: null, inEvent: true });
    }
  });

  it("leaves the definitions pages and the other More pages where they were", () => {
    expect(staffPlaceFor("/admin/club-forms")).toMatchObject({ area: "admin", tab: "hub-forms", view: "/admin/club-forms" });
    expect(staffPlaceFor("/more/club-assignments")).toMatchObject({ inEvent: true });
    expect(staffPlaceFor("/more/club-forms-other")).toMatchObject({ inEvent: true });
  });

  const nav = (input: { isSystemAdmin: boolean; search: string; selected: boolean }) => buildStaffNavigation({
    pathname: "/more/club-forms",
    search: new URLSearchParams(input.search),
    isSystemAdmin: input.isSystemAdmin,
    adminRoleView: input.isSystemAdmin ? { held: ["SYSTEM_ADMIN"], active: "SYSTEM_ADMIN", counts: {}, healthImport: true } : null,
    siteContentEditor: false,
    hasEvents: true,
    ...(input.selected ? { selectedEvent: { id: "event_1", permissions: [], clubFormsAccess: true, hiddenCardKeys: [] } } : {}),
  });

  it("draws the Admin Forms tab for a system administrator with no event, and no event tabs", () => {
    const shell = nav({ isSystemAdmin: true, search: "", selected: true });
    expect(shell.place.inEvent).toBe(false);
    expect(shell.currentTab?.key).toBe("hub-forms");
    expect(shell.rowTabs.some((tab) => "key" in tab && tab.key === "hub-forms")).toBe(true);
    expect(shell.rail.find((item) => item.area === "admin")).toBeTruthy();
  });

  it("draws the event shell for a system administrator who came from an event", () => {
    const shell = nav({ isSystemAdmin: true, search: "event=event_1", selected: true });
    expect(shell.place.inEvent).toBe(true);
    expect(shell.eventTabs.length).toBeGreaterThan(0);
  });

  it("keeps the event shell for an Event Admin with no Admin area on the no-event URL (the alert email link)", () => {
    for (const path of ["/more/club-forms", "/more/club-forms/sub_1"]) {
      const shell = buildStaffNavigation({
        pathname: path,
        search: new URLSearchParams(""),
        isSystemAdmin: false,
        adminRoleView: null,
        siteContentEditor: false,
        hasEvents: true,
        selectedEvent: { id: "event_1", permissions: [], clubFormsAccess: true, hiddenCardKeys: [] },
      });
      expect(shell.place).toEqual({ area: "events", tab: null, view: null, inEvent: true });
      expect(shell.rail.some((item) => item.area === "events")).toBe(true);
    }
  });
});

describe("the Club forms definitions page (#1573)", () => {
  it("uses the list template with the title, the strip below it and the public page as the one secondary button", () => {
    expect(definitions).toContain("<ListPage header={{ title: \"Club forms\"");
    expect(definitions).toContain('<ClubFormsViewsStrip administration current="definitions" />');
    expect(definitions).toContain("secondary: publicPageLink");
    expect(definitions).not.toContain("See submitted forms");
    expect(definitions).not.toContain("StaffPageHeader");
    expect(definitions).not.toContain('className="page-intro"');
  });

  it("keeps the section header above the template and draws it once per view", () => {
    expect(definitions.match(/<AdminPageHeader\b/g)).toHaveLength(2);
    expect(definitions.indexOf("<AdminPageHeader path=\"/admin/club-forms\" />")).toBeLessThan(definitions.indexOf("<ListPage header={{ title: \"Club forms\", description, secondary: publicPageLink, below: <ClubFormsViewsStrip administration current=\"definitions\""));
  });

  it("puts New form, then Sync templates, above the definitions list", () => {
    const create = definitions.indexOf("<ClubFormCreate");
    const sync = definitions.indexOf("<ClubFormSync");
    const help = definitions.indexOf("club-forms-help-heading");
    const table = definitions.indexOf('<table role="table"');
    expect(create).toBeGreaterThan(0);
    expect(create).toBeLessThan(sync);
    expect(sync).toBeLessThan(help);
    expect(help).toBeLessThan(table);
    expect(definitions.match(/<ClubFormCreate\b/g)).toHaveLength(1);
  });

  it("keeps the whole of the old paragraph, split between a one-sentence description and a notice", () => {
    expect(definitions).toContain('description = "Forms clubs fill in for their members or send by private link."');
    for (const phrase of ["Every form starts off.", "shows in each club&apos;s Forms tab for its director and deputy", "checked against the official forms before you turn a form on"]) expect(definitions).toContain(phrase);
  });

  it("keeps the access check, the redirect states and the table", () => {
    expect(definitions).toContain("hasClubsAdministration(user)");
    expect(definitions).toContain('redirect("/no-access")');
    expect(definitions).toContain('role="table" className="report-table table-cards table-cards-wide"');
  });

  it("draws the missing view with the same header and strip, and its list has no back link", () => {
    expect(definitions).toContain('current="missing" year={year}');
    expect(definitions).toContain("<ClubsFormsMissingList");
    expect(missingList).not.toContain("BackLink");
    expect(missingList).not.toContain("Back to club administration");
    expect(missingList).not.toMatch(/<h1\b/);
  });
});

describe("the club form builder page (#1573)", () => {
  it("draws a titled header with the form's name and exactly one back link", () => {
    expect(builder).toContain("<DetailPage");
    expect(builder).toContain("header={{ title: view.published.name }}");
    expect(builder).not.toContain('className="page-intro"');
    expect(builder).not.toContain("back:");
    expect(builder.match(/<BackLink\b/g)).toBeNull();
    expect(builder).toContain("<AdminPageHeader");
    expect(builder.match(/<BuilderPhoneNotice\b/g)).toHaveLength(1);
  });

  it("keeps the explanation as a notice and shows a read-only status that points to the list", () => {
    expect(builder).toContain("Changes are saved as a draft.");
    expect(builder).toContain("Form status");
    for (const field of ["view.enabled", "view.version", "view.draftStale", "view.submissionCount"]) expect(builder).toContain(field);
    expect(builder).toContain("Who fills it in and whether it is required are set on the");
    expect(builder).toContain('<Link href="/admin/club-forms">Club forms list</Link>');
  });

  it("leaves the builder component and its gate alone", () => {
    expect(builder).toContain("<ClubFormBuilder");
    expect(builder).toContain("hasClubsAdministration(user)");
  });
});

describe("the submitted club forms pages (#1573)", () => {
  it("uses the list template with the page title, the strip, the filters slot and the pager", () => {
    expect(submissions).toContain("<ListPage");
    expect(submissions).toContain("title: staffPageTitles.clubForms");
    expect(submissions).toContain('<ClubFormsViewsStrip administration={canReadBirthDates} current="submissions" event={event} />');
    expect(submissions).toContain("filters={(");
    expect(submissions).toContain("pager={{ hrefFor: pageHref");
    expect(submissions).not.toContain('className="page-intro"');
    expect(submissions).not.toContain("duplicate-page-title");
  });

  it("decides the strip from the viewer the page already has, with no new access query", () => {
    expect(submissions).toContain("const canReadBirthDates = viewer.systemAdmin || viewer.clubsAdministrator;");
    expect(submissions).not.toContain("hasClubsAdministration");
    expect(submissions).not.toContain("isActiveClubsAdministrator");
  });

  it("keeps every sentence of the privacy paragraph in a notice under the header", () => {
    for (const phrase of [
      "You can read health and conduct answers; each time you open a form that has them, it is recorded.",
      "Health and conduct answers show as Restricted for your role.",
      "Emergency contact and physician and clinic answers on the Off-Premises Permission Slip and the Transportation Passenger List are plain, so everyone who can see those forms sees them.",
      "you can also read birth dates.",
      "Birth dates show as Restricted: only the club's own director and deputies, system administrators and Clubs Administrators can read them.",
    ]) expect(submissions).toContain(phrase);
    expect(submissions).toContain('description: "Submitted forms by club."');
  });

  it("draws the title in the restricted state, and keeps the empty state apart from it", () => {
    expect(submissions).toContain("<PageHeader title={staffPageTitles.clubForms} />");
    expect(submissions).toContain("Club forms are restricted");
    expect(submissions).toContain("No submitted forms match.");
  });

  it("turns the table into phone cards with exactly today's columns", () => {
    expect(submissions).toContain('role="table" className="report-table table-cards table-cards-wide"');
    for (const label of ["Form", "Member or subject", "Submitted", "Entered"]) expect(submissions).toContain(`cardCell("${label}")`);
    expect(submissions).toContain("cardCell(null)");
    expect(submissions).toContain('<th role="rowheader" scope="row" translate="no">{row.organizationName}</th>');
    for (const column of ["club", "form", "subject", "submitted", "entered"]) expect(submissions).toContain(`column="${column}"`);
    expect(submissions).toContain("Download CSV (non-sensitive columns)");
  });

  it("keeps the audited load and the access checks of the detail page, with one back link that reads Back to submissions", () => {
    expect(submission).toContain("getSubmissionForViewer(viewer, submissionId)");
    expect(submission.match(/back=\{\{/g)).toHaveLength(1);
    expect(submission).not.toContain("BackLink");
    expect(submission).toContain('label: "Back to submissions"');
    expect(submission).toContain("title={staffPageTitles.clubForm}");
    expect(submission).toContain("secondary={<PrintFormButton />}");
    expect(submission).toContain("`/more/club-forms${event ? `?event=${encodeURIComponent(event)}` : \"\"}`");
  });
});

describe("the submission page header does not print (#1573)", () => {
  it("sits inside the wrapper the print rules already hide, in the restricted state too", () => {
    expect(submission).toMatch(/<div className="club-form-page-actions">\s*<PageHeader/);
    expect(read("app/globals.css")).toMatch(/@media print \{\s*\.sidebar[^}]*\.club-form-page-actions[^}]*display: none !important/);
    expect(submission).toContain("<PageHeader title={staffPageTitles.clubForm} />");
    expect(submission).toContain("<ClubFormSubmissionView");
  });

  it("is listed as a page that draws its own header", () => {
    expect(read("components/page-header-routes.ts")).toContain('pattern: "/more/club-forms/[submissionId]"');
  });
});

describe("the On or Off help says what the switch does (#1573)", () => {
  it("names each verified effect", () => {
    for (const phrase of ["private links work", "opens its public application", "public club forms page link to it", "Missing forms view", "Area Coordinators", "Everything already filled in is kept"]) expect(definitions).toContain(phrase);
  });
});
