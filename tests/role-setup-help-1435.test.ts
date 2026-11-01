import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/account/area-clubs/overview",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));

import { ClubHomeEvents, ClubHomeRoster } from "@/components/club-home";
import { CoordinatorOverviewBody } from "@/components/coordinator-overview";
import { CoordinatorWhosMissing } from "@/components/coordinator-whos-missing";
import { ClubSetupHelp, CoordinatorSetupHelp } from "@/components/role-setup-help";
import { EventSetupChecklist } from "@/components/event-setup-checklist";
import { SetupChecklistPanel } from "@/components/setup-checklist-panel";
import { summarizeClub } from "@/modules/club-reports/area-summary-domain";
import { buildCoordinatorOverview } from "@/modules/club-reports/coordinator-overview-domain";
import { whosMissingWhat } from "@/modules/club-reports/whos-missing-what";
import { filterGuides } from "@/modules/help/visibility";
import { portalDestinations, portalGuides } from "@/modules/help/portal-guides";
import { portalGuideLinksForViewer, visiblePortalGuides, type PortalHelpViewer } from "@/modules/help/portal-visibility";
import { clubCapabilities, type ClubRole } from "@/modules/organizations/director-grants-domain";
import { summarizeChecklist, type ChecklistStep } from "@/modules/setup-help/checklist";
import { buildClubChecklist, type ClubChecklistFacts } from "@/modules/setup-help/club-checklist";
import { CLUB_SETUP_IDS, clubSetupFor } from "@/modules/setup-help/club-setup-steps";
import { buildCoordinatorChecklist } from "@/modules/setup-help/coordinator-checklist";
import { COORDINATOR_SETUP_IDS, coordinatorSetupFor } from "@/modules/setup-help/coordinator-setup-steps";
import { roleSetupHasNextStep, type RoleSetupEntry } from "@/modules/setup-help/role-setup";

/**
 * #1435: every "not set up / missing / blocked / empty" state a club director or area coordinator can meet shows a Set
 * up link, How-to steps or who to ask (rules H3, H4), each role has a Getting started checklist and guide (H5), and the
 * coordinator's "Who's missing what" never shows a club outside the coordinator's own list. Synthetic data only.
 */

const root = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const base = "/account/clubs/club_1";
const now = new Date("2026-11-01T12:00:00.000Z");
const CLUB_PORTAL = "app/(public)/account/(portal)/clubs/[organizationId]/";
const AREA = "app/(public)/account/(portal)/area/[organizationId]/";
const COORD = "app/(public)/account/(portal)/area-clubs/";

/** True when the file renders `<Tag ... id="..." />` (or an id inside a conditional) for this id. */
const rendersHelp = (source: string, tag: string, id: string) =>
  source.split(`<${tag}`).slice(1).some((part) => part.slice(0, part.indexOf("/>") + 2).includes(`"${id}"`));

/** The inventory: where each state renders its help. A new id without a row here fails the "every id is used" test. */
const CLUB_SITES: Array<[file: string, id: (typeof CLUB_SETUP_IDS)[number]]> = [
  ["components/club-home.tsx", "roster-empty"],
  ["components/club-home.tsx", "events-none-registered"],
  ["components/club-home.tsx", "events-none-published"],
  ["components/club-honors-workspace.tsx", "honors-no-members"],
  ["components/club-earned-awards-workspace.tsx", "awards-no-members"],
  ["components/club-event-list.tsx", "events-none-published"],
  [`${CLUB_PORTAL}events/[eventId]/page.tsx`, "event-team-none"],
  [`${CLUB_PORTAL}events/[eventId]/page.tsx`, "event-form-problem"],
  [`${CLUB_PORTAL}events/[eventId]/page.tsx`, "event-registration-closed"],
  [`${CLUB_PORTAL}events/[eventId]/schedule/page.tsx`, "event-no-schedule"],
  [`${CLUB_PORTAL}events/[eventId]/schedule/page.tsx`, "event-roster-empty"],
  ["components/club-registration-workspace.tsx", "event-roster-empty"],
  ["components/club-class-picker.tsx", "classes-location-needed"],
  ["components/club-class-picker.tsx", "classes-closed"],
  ["components/club-meeting-notes.tsx", "meetings-none"],
  ["components/club-supply-stock-workspace.tsx", "supplies-no-catalog"],
  ["components/club-access-gate.tsx", "two-step-needed"],
  ["components/director-sterling-followup.tsx", "sterling-follow-up"],
  [`${CLUB_PORTAL}records/page.tsx`, "records-role"],
  [`${CLUB_PORTAL}records/page.tsx`, "records-not-due"],
  [`${CLUB_PORTAL}reports/year-end/[year]/page.tsx`, "year-end-role"],
  [`${CLUB_PORTAL}forms/page.tsx`, "forms-role"],
  [`${CLUB_PORTAL}forms/page.tsx`, "forms-none"],
  [`${CLUB_PORTAL}health/page.tsx`, "health-role"],
  [`${CLUB_PORTAL}health/page.tsx`, "health-none"],
  [`${CLUB_PORTAL}roster/[memberId]/health/page.tsx`, "health-role"],
  [`${CLUB_PORTAL}club-info/page.tsx`, "club-settings-role"],
  [`${CLUB_PORTAL}roster/next-year/page.tsx`, "next-year-role"],
  ["app/(public)/account/(portal)/clubs/page.tsx", "no-clubs"],
  ["app/(public)/account/(portal)/clubs/choose/page.tsx", "no-clubs"],
];
const COORDINATOR_SITES: Array<[file: string, id: (typeof COORDINATOR_SETUP_IDS)[number]]> = [
  ["components/coordinator-overview.tsx", "no-clubs"],
  ["components/coordinator-overview.tsx", "unavailable"],
  ["components/coordinator-whos-missing.tsx", "whos-missing"],
  ["components/coordinator-destinations.tsx", "no-clubs"],
  ["components/coordinator-destinations.tsx", "events-none"],
  ["components/area-clubs-views.tsx", "no-clubs"],
  ["components/area-clubs-views.tsx", "events-none"],
  [`${COORD}points/page.tsx`, "points-none"],
  ["components/club-overview.tsx", "club-no-director"],
  ["components/club-overview.tsx", "events-none"],
  ["components/club-overview.tsx", "club-reports-none-due"],
  ["app/(public)/account/(portal)/area/[organizationId]/page.tsx", "club-no-emergency-contacts"],
  [`${AREA}forms/page.tsx`, "club-no-forms"],
  [`${AREA}reports/[month]/page.tsx`, "club-no-report"],
];

describe("every club and coordinator state has a next step (H3, H4)", () => {
  it("gives every club state a Set up link, steps or who to ask, and a real Help guide", () => {
    for (const id of CLUB_SETUP_IDS) {
      const entry = clubSetupFor(id, base);
      expect(roleSetupHasNextStep(entry), id).toBe(true);
      const guide = portalGuides.find((candidate) => candidate.id === entry.guideId);
      expect(guide, `${id} -> ${entry.guideId}`).toBeDefined();
      expect(guide!.audience, id).toBe("director");
      if ("href" in entry.setup) expect(entry.setup.href.startsWith(base) || entry.setup.href === "/account/security", id).toBe(true);
    }
  });

  it("gives every coordinator state a next step and a coordinator guide", () => {
    for (const id of COORDINATOR_SETUP_IDS) {
      const entry = coordinatorSetupFor(id);
      expect(roleSetupHasNextStep(entry), id).toBe(true);
      expect(portalGuides.find((candidate) => candidate.id === entry.guideId)?.audience, id).toBe("coordinator");
    }
  });

  it("says who to ask when only someone else can fix it", () => {
    for (const id of ["forms-none", "forms-role", "records-role", "events-none-published", "supplies-no-catalog"] as const) {
      expect(clubSetupFor(id, base).whoToAsk, id).toMatch(/ask/i);
    }
    expect(coordinatorSetupFor("club-no-director").whoToAsk).toMatch(/conference office/i);
  });

  it("keeps steps free of secrets, setting names and a dead end", () => {
    const entries: RoleSetupEntry[] = [...CLUB_SETUP_IDS.map((id) => clubSetupFor(id, base)), ...COORDINATOR_SETUP_IDS.map((id) => coordinatorSetupFor(id))];
    for (const entry of entries) {
      if ("steps" in entry.setup) {
        expect(entry.setup.settingNames).toEqual([]);
        expect(entry.setup.docsLink).toBeNull();
        expect(entry.setup.steps.join(" ")).not.toMatch(/api[_ ]?key|secret|password/i);
      }
    }
  });

  it("renders help at every inventoried page (source scan), and every id is used somewhere", () => {
    for (const [file, id] of CLUB_SITES) expect(rendersHelp(read(file), "ClubSetupHelp", id), `${file} ${id}`).toBe(true);
    for (const [file, id] of COORDINATOR_SITES) expect(rendersHelp(read(file), "CoordinatorSetupHelp", id), `${file} ${id}`).toBe(true);
    const usedClub = new Set(CLUB_SITES.map(([, id]) => id));
    const usedCoordinator = new Set(COORDINATOR_SITES.map(([, id]) => id));
    for (const id of CLUB_SETUP_IDS) expect(usedClub.has(id), `unused club id ${id}`).toBe(true);
    for (const id of COORDINATOR_SETUP_IDS) expect(usedCoordinator.has(id), `unused coordinator id ${id}`).toBe(true);
  });
});

describe("rendered help", () => {
  it("shows the roster steps, a guide link and nothing for a read-only past year", () => {
    const empty = { rows: [], total: 0 };
    const html = renderToStaticMarkup(createElement(ClubHomeRoster, { clubYear: "2026-2027", preview: empty, readOnly: false, rosterHref: `${base}/roster`, setupBase: base }));
    expect(html).toContain("data-role-setup-help");
    expect(html).toContain("How to do this");
    expect(html).toContain("/account/help/director-roster-and-forms");
    const past = renderToStaticMarkup(createElement(ClubHomeRoster, { clubYear: "2025-2026", preview: empty, readOnly: true, rosterHref: `${base}/roster`, setupBase: base }));
    expect(past).not.toContain("data-role-setup-help");
  });

  it("tells a director with no open event who to ask", () => {
    const html = renderToStaticMarkup(createElement(ClubHomeEvents, { cards: [], eventsHref: `${base}/events`, hasOpenEvents: false, setupBase: base }));
    expect(html).toMatch(/Only the conference office can open registration/);
    expect(html).toContain("/account/help/director-register-for-events");
  });

  it("renders a Set up link for an in-app state and who to ask beside steps", () => {
    const link = renderToStaticMarkup(createElement(ClubSetupHelp, { base, id: "honors-no-members" }));
    expect(link).toContain(`href="${base}/roster"`);
    const ask = renderToStaticMarkup(createElement(CoordinatorSetupHelp, { id: "club-no-director" }));
    expect(ask).toMatch(/Ask them|Ask the conference office|Only the conference office/);
  });

  it("shows setup help on the coordinator Overview with no clubs", () => {
    const overview = buildCoordinatorOverview([], "2026-2027", now);
    const html = renderToStaticMarkup(createElement(CoordinatorOverviewBody, { data: { status: "ready", clubs: [], overview }, now, query: "" }));
    expect(html).toContain("No active clubs are available to this role yet.");
    expect(html).toContain("data-role-setup-help");
    expect(html).toContain("/account/help/coordinator-getting-started");
  });
});

const club = (id: string, over: Partial<Parameters<typeof summarizeClub>[0]> = {}) =>
  summarizeClub(
    { id, name: `Synthetic Club ${id}`, church: `Synthetic Church ${id}`, directors: ["Sample Director"], rosterSize: 12, registrationOnTime: true, backgroundChecks: { missing: 0, notInCompliance: 0, expiringSoon: 0 }, reports: [], ...over },
    "2026-2027",
    now,
  );

describe("Who's missing what is scoped to the coordinator's own clubs", () => {
  const filed = (month: string) => ({ reportMonth: month, status: "SUBMITTED" as const, totalPoints: 10, onTimePoints: 5 });
  it("lists only clubs it was given, and only those missing something", () => {
    const upToDate = [filed("2026-09"), filed("2026-10")];
    const fine = club("a", { reports: upToDate });
    const noDirector = club("b", { directors: [], reports: upToDate });
    const behind = club("c");
    const rows = whosMissingWhat([fine, noDirector, behind], "2026-10", now);
    expect(rows.map((row) => row.clubId).sort()).toEqual(["b", "c"]);
    // Nothing outside the input can appear, even though another club exists in the world.
    expect(rows.every((row) => [fine, noDirector, behind].some((input) => input.id === row.clubId))).toBe(true);
  });

  it("gives each club one next step to its own view-only page, naming who to ask for a missing director", () => {
    const rows = whosMissingWhat([club("b", { directors: [] }), club("c")], "2026-10", now);
    const b = rows.find((row) => row.clubId === "b")!;
    expect(b.items.map((item) => item.label)).toContain("No director");
    expect(b.next.text).toMatch(/conference office/i);
    expect(b.next.href).toBe("/account/area/b");
    const c = rows.find((row) => row.clubId === "c")!;
    expect(c.next.href).toBe("/account/area/c");
    expect(c.items.find((item) => item.kind === "RECORD_MISSING")?.tone).toBe("coral");
  });

  it("carries no birth date, medical detail, note or contact: only names, a church and labels", () => {
    const [row] = whosMissingWhat([club("c")], "2026-10", now);
    expect(Object.keys(row!).sort()).toEqual(["church", "clubId", "items", "name", "next"]);
    expect(JSON.stringify(row)).not.toMatch(/birth|medical|allerg|phone|email|note/i);
  });

  it("renders the shared status chips and the club's own page link", () => {
    const rows = whosMissingWhat([club("b", { directors: [] })], "2026-10", now);
    const html = renderToStaticMarkup(createElement(CoordinatorWhosMissing, { clubCount: 3, monthLabel: "October 2026", rows }));
    expect(html).toContain("status-chip coral");
    expect(html).toContain('href="/account/area/b"');
    expect(html).toContain("Synthetic Club b");
    expect(html).not.toContain("Synthetic Club a");
  });

  it("is wired only to the Overview's own rows, behind the coordinator check", () => {
    const body = read("components/coordinator-overview.tsx");
    expect(body).toContain("whosMissingWhat(clubs, overview.month, now)");
    const page = read(`${COORD}overview/page.tsx`);
    expect(page.indexOf("currentAreaCoordinatorViewerActive")).toBeLessThan(page.indexOf("getAreaClubsSummary(clubYear)"));
    const view = read("components/coordinator-whos-missing.tsx") + read("modules/club-reports/whos-missing-what.ts");
    expect(view).not.toMatch(/getPrisma|repository|fetch\(/);
  });
});

describe("the club director's Getting started checklist", () => {
  const facts = (role: ClubRole, over: Partial<ClubChecklistFacts> = {}): ClubChecklistFacts => ({
    base,
    role,
    capabilities: clubCapabilities(role),
    staffActing: false,
    rosterCount: 0,
    registeredEventCount: 0,
    hasOpenEvents: true,
    recordsDueNow: 1,
    sterlingReminders: 2,
    ...over,
  });

  it("derives done from the data and never gives a checkmark to a step it cannot derive", () => {
    const list = buildClubChecklist(facts("DIRECTOR"));
    const by = Object.fromEntries(list.steps.map((step) => [step.id, step]));
    expect(by.roster!.done).toBe(false);
    expect(by.events!.done).toBe(false);
    expect(by.records!.done).toBe(false);
    expect(by.sterling!.done).toBe(false);
    for (const id of ["leaders", "forms", "orders", "help"]) {
      expect(by[id]!.reference, id).toBe(true);
      expect(by[id]!.done, id).toBe(false);
    }
    const done = buildClubChecklist(facts("DIRECTOR", { rosterCount: 14, registeredEventCount: 1, recordsDueNow: 0, sterlingReminders: 0 }));
    expect(done.steps.filter((step) => !step.reference).every((step) => step.done)).toBe(true);
    expect(done.hidden).toBe(true);
  });

  it("treats a failed read as unknown (a guide row), never as done or as zero", () => {
    const list = buildClubChecklist(facts("DIRECTOR", { rosterCount: null, registeredEventCount: null, recordsDueNow: null, sterlingReminders: null }));
    for (const id of ["roster", "events", "records", "sterling"]) {
      const step = list.steps.find((candidate) => candidate.id === id)!;
      expect(step.reference, id).toBe(true);
      expect(step.done, id).toBe(false);
    }
  });

  it("does not link a role to a page it cannot open, and says who to ask", () => {
    const registrar = buildClubChecklist(facts("REGISTRAR"));
    const step = (id: string) => registrar.steps.find((candidate) => candidate.id === id)!;
    expect(step("leaders").linkable).toBe(false);
    expect(step("forms").linkable).toBe(false);
    expect(step("records").linkable).toBe(false);
    expect(step("records").unavailableNote).toMatch(/Ask your club's director/);
    expect(step("roster").linkable).toBe(true);
    const reporter = buildClubChecklist(facts("REPORTER"));
    expect(reporter.steps.find((candidate) => candidate.id === "roster")!.linkable).toBe(false);
    expect(reporter.steps.find((candidate) => candidate.id === "records")!.linkable).toBe(true);
  });

  it("does not call a staff act-as session done for two-step sign-in", () => {
    const step = buildClubChecklist(facts("DIRECTOR", { staffActing: true })).steps[0]!;
    expect(step.reference).toBe(true);
    expect(step.done).toBe(false);
  });

  it("links every step to a Help guide that exists for directors", () => {
    for (const role of ["DIRECTOR", "DEPUTY", "REGISTRAR", "REPORTER"] as const) {
      for (const step of buildClubChecklist(facts(role)).steps) {
        const id = step.helpHref!.replace("/account/help/", "");
        expect(portalGuides.find((guide) => guide.id === id)?.audience, `${role} ${step.id}`).toBe("director");
      }
    }
  });

  it("names the sign-in step 'Two-step sign-in' and leads with the passkey (A3 to A5)", () => {
    const step = buildClubChecklist(facts("DIRECTOR")).steps[0]!;
    expect(step.label).toBe("Two-step sign-in");
    expect(step.detail).toMatch(/passkey/i);
    expect(step.detail).toMatch(/protects youth and medical records/i);
    const guide = portalGuides.find((candidate) => candidate.id === "director-two-step-sign-in")!;
    expect(guide.steps.findIndex((text) => /passkey/i.test(text))).toBeLessThan(guide.steps.findIndex((text) => /authenticator app/i.test(text)));
    expect(guide.steps.join(" ")).toMatch(/Easiest/);
  });
});

describe("the area coordinator's Getting started checklist", () => {
  const facts = { clubYear: "2026-2027", clubCount: 4, clubsWithoutDirector: 1, recordsMissing: 2, monthNotDue: false, monthLabel: "October 2026", clubsBehind: 3 };

  it("derives progress from the Overview's counts and points the director step at who to ask", () => {
    const list = buildCoordinatorChecklist(facts);
    const by = Object.fromEntries(list.steps.map((step) => [step.id, step]));
    expect(by.directors!.done).toBe(false);
    expect(by.directors!.linkable).toBe(false);
    expect(by.directors!.unavailableNote).toMatch(/conference office/);
    expect(by.records!.done).toBe(false);
    expect(by.behind!.done).toBe(false);
    expect(list.nextStepId).toBe("directors");
    const clear = buildCoordinatorChecklist({ ...facts, clubsWithoutDirector: 0, recordsMissing: 0, clubsBehind: 0 });
    expect(clear.hidden).toBe(true);
  });

  it("does not count a month that is not due, or an empty area, as done", () => {
    const early = buildCoordinatorChecklist({ ...facts, monthNotDue: true, recordsMissing: 0 });
    expect(early.steps.find((step) => step.id === "records")!.reference).toBe(true);
    const none = buildCoordinatorChecklist({ ...facts, clubCount: 0, clubsWithoutDirector: 0, recordsMissing: 0, clubsBehind: 0 });
    expect(none.steps.find((step) => step.id === "directors")!.done).toBe(false);
  });

  it("links every step to a coordinator guide", () => {
    for (const step of buildCoordinatorChecklist(facts).steps) {
      const id = step.helpHref!.replace("/account/help/", "");
      expect(portalGuides.find((guide) => guide.id === id)?.audience, step.id).toBe("coordinator");
    }
  });
});

describe("shared checklist look", () => {
  it("summarizes tracked steps only and hides when none are left", () => {
    const step = (id: string, done: boolean, reference = false): ChecklistStep => ({ id, label: id, detail: id, done, href: "/x", linkable: true, actionLabel: "Open", reference });
    const list = summarizeChecklist([step("a", true), step("b", false), step("c", false, true)]);
    expect(list.trackedCount).toBe(2);
    expect(list.doneCount).toBe(1);
    expect(list.nextStepId).toBe("b");
    expect(summarizeChecklist([step("a", true), step("c", false, true)]).hidden).toBe(true);
  });

  it("keeps the event Dashboard markup (same ids and classes) and adds nothing for it", () => {
    const html = renderToStaticMarkup(createElement(EventSetupChecklist, {
      eventId: "event-1",
      checklist: {
        steps: [{ id: "basics", label: "Event basics", detail: "A name.", done: false, href: "/more/event-settings", linkable: true, actionLabel: "Open event settings" }],
        doneCount: 0,
        nextStepId: "basics",
        hidden: false,
      },
    }));
    expect(html).toContain('id="setup-checklist-title"');
    expect(html).toContain('id="setup-checklist-steps"');
    expect(html).toContain("Set up this event");
    expect(html).toContain("0 of 1 done");
    expect(html).not.toContain("setup-step-actions");
    expect(html).not.toContain("Help guide");
  });

  it("renders a Help guide link and a reference row without a checkmark", () => {
    const html = renderToStaticMarkup(createElement(SetupChecklistPanel, {
      checklist: summarizeChecklist([
        { id: "a", label: "Roster", detail: "Add people.", done: false, href: "/r", linkable: true, actionLabel: "Open roster", helpHref: "/account/help/x" },
        { id: "b", label: "Orders", detail: "Build a list.", done: false, href: "/o", linkable: true, actionLabel: "Open Orders", reference: true },
      ]),
      eyebrow: "Getting started",
      storageKey: "k",
      title: "Get set",
    }));
    expect(html).toContain("0 of 1 done");
    expect(html).toContain('href="/account/help/x"');
    expect(html).toContain("is-reference");
  });
});

describe("guides are findable and link to real pages", () => {
  const director: PortalHelpViewer = { hasAccount: true, directedClubs: [{ organizationId: "club_1", role: "DIRECTOR" }], isAreaCoordinator: false, acting: null };
  const registrar: PortalHelpViewer = { ...director, directedClubs: [{ organizationId: "club_1", role: "REGISTRAR" }] };
  const coordinator: PortalHelpViewer = { hasAccount: true, directedClubs: [], isAreaCoordinator: true, acting: null };

  it("finds Getting started, two-step and the setup topics through Help search", () => {
    const guides = visiblePortalGuides(director);
    expect(filterGuides(guides, "getting started").map((guide) => guide.id)).toContain("director-getting-started");
    expect(filterGuides(guides, "passkey").map((guide) => guide.id)).toContain("director-two-step-sign-in");
    expect(filterGuides(guides, "invite").map((guide) => guide.id)).toContain("director-leaders-and-invites");
    expect(filterGuides(guides, "sterling").map((guide) => guide.id)).toContain("director-honors-and-sterling");
    expect(filterGuides(visiblePortalGuides(coordinator), "who's missing").map((guide) => guide.id)).toContain("coordinator-follow-up-clubs");
    expect(filterGuides(visiblePortalGuides(coordinator), "getting started").map((guide) => guide.id)).toContain("coordinator-getting-started");
  });

  it("does not show a director guide to a coordinator-only account, or the reverse", () => {
    expect(visiblePortalGuides(coordinator).some((guide) => guide.audience === "director")).toBe(false);
    expect(visiblePortalGuides(director).some((guide) => guide.audience === "coordinator")).toBe(false);
  });

  it("never links a registrar to the club forms page, and names the page for a director", () => {
    const getting = portalGuides.find((guide) => guide.id === "director-getting-started")!;
    const registrarLinks = portalGuideLinksForViewer(getting, registrar).links.map((link) => link.label);
    expect(registrarLinks).not.toContain("Forms");
    expect(registrarLinks).not.toContain("Club settings");
    expect(registrarLinks).not.toContain("Monthly Records");
    expect(portalGuideLinksForViewer(getting, director).links.map((link) => link.label)).toEqual(expect.arrayContaining(["Forms", "Club settings", "Monthly Records", "Orders"]));
    expect(Object.keys(portalDestinations)).toEqual(expect.arrayContaining(["club-forms", "club-events", "coordinator-points"]));
  });
});
