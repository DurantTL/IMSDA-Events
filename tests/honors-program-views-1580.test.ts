import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/more/team-results", useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("server-only", () => ({}));

import { HonorsMoveDialog, HonorsScheduleAgenda } from "@/components/honors-schedule-agenda";
import { HonorsViewsStrip } from "@/components/honors-views-strip";
import { TeamResultsWorkspace } from "@/components/team-results-workspace";
import { buildBoardSections, instructorClashes, moveTargetProblem, type BoardCard, type ScheduleBoardData } from "@/modules/honors/schedule-board";

const read = (path: string) => readFileSync(path, "utf8");

const card = (over: Partial<BoardCard>): BoardCard => ({
  id: "c1", title: "Sample Knots", span: "SINGLE_SESSION", sessionId: "s1", siteId: null, roomId: "r1", capacity: 10, seatsTaken: 4, enrolled: 4,
  isActive: true, teacherName: "", instructors: [{ id: "i1", name: "Pat Synthetic" }], ...over,
});
const board: ScheduleBoardData = {
  sites: [],
  sessions: [{ id: "s1", name: "Session One", locationId: null, sortOrder: 1 }, { id: "s2", name: "Session Two", locationId: null, sortOrder: 2 }],
  rooms: [{ id: "r1", name: "Room A", capacity: 12, locationId: null, sortOrder: 1 }, { id: "r2", name: "Tiny Room", capacity: 5, locationId: null, sortOrder: 2 }],
  cards: [
    card({}),
    card({ id: "c2", title: "Sample Fire Building", sessionId: "s2", roomId: "r1", seatsTaken: 10, enrolled: 10, instructors: [{ id: "i1", name: "Pat Synthetic" }] }),
    card({ id: "c3", title: "Sample Birds", sessionId: "s1", roomId: null, seatsTaken: 8, enrolled: 8, instructors: [{ id: "i1", name: "Pat Synthetic" }] }),
  ],
};
const sections = buildBoardSections(board);

describe("schedule agenda (#1580)", () => {
  const markup = renderToStaticMarkup(createElement(HonorsScheduleAgenda, {
    eventId: "e1", section: sections[0], clashes: instructorClashes(board.cards, board.sessions), busy: false, onOpenMove: () => undefined,
  }));

  it("lists each session and All sessions with room, seats, instructors and the board's chips", () => {
    for (const text of ["Session One", "Session Two", "All sessions", "Sample Knots", "Room A", "4 / 10 seats", "Pat Synthetic", "Nearly full", "Full", "No room yet"]) {
      expect(markup, text).toContain(text);
    }
    expect(markup).toContain("Clash");
  });

  it("says what to do next in an empty session, with a link to the Classes page", () => {
    expect(markup).toContain("No classes here. Add classes on the");
    expect(markup).toContain('href="/more/honors?event=e1"');
  });

  it("gives every class a Move button named for the class", () => {
    expect(markup).toContain('aria-label="Move Sample Knots"');
    expect(markup).toContain("Move…");
  });
});

describe("Move dialog (#1580)", () => {
  const target = board.cards[0];
  const render = (open: boolean) => renderToStaticMarkup(createElement(HonorsMoveDialog, {
    card: open ? target : null, sections, busy: false, onMove: () => undefined, onClose: () => undefined,
    targetProblem: (moved, place) => moveTargetProblem(moved, place, board.rooms, board.cards),
  }));

  it("renders nothing while closed", () => {
    expect(render(false)).toBe("");
  });

  it("is a labelled modal dialog listing every place with Move here or the board's own reason", () => {
    const markup = render(true);
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain("Move Sample Knots");
    expect(markup).toContain("It is already here.");
    // Said once, not per room.
    expect(markup.split("A single-session class can&#x27;t move into All sessions.").length - 1).toBe(1);
    expect(markup).toContain("Tiny Room seats 5, and this class has 10 seats.");
    expect(markup).toContain("Room A already has a class then.");
    expect(markup).toContain('aria-label="Move Sample Knots to no room, Session Two"');
  });
});

describe("schedule board views without a jump (#1580)", () => {
  it("renders both views until one is chosen and lets CSS pick, then honours the choice", () => {
    const board = read("components/honors-schedule-board.tsx");
    expect(board).toContain("agendaStyles.autoAgenda");
    expect(board).toContain("agendaStyles.autoBoard");
    expect(board).toContain('choice !== "board"');
    const css = read("components/honors-schedule-agenda.module.css");
    expect(css).toMatch(/max-width: 1023\.98px\) \{ \.autoBoard \{ display: none; \}/);
    expect(css).toMatch(/min-width: 1024px\) \{ \.autoAgenda \{ display: none; \}/);
  });

  it("keeps a heading on the frozen roster that the print rule matches", () => {
    expect(read("app/(workspace)/more/program-assignments/[runId]/page.tsx")).toContain('className="assignment-roster-heading"');
    expect(read("app/globals.css")).toContain(".assignment-roster-heading { font-size: 18pt; }");
    expect(read("app/globals.css")).not.toContain("assignment-roster-intro");
  });
});

describe("Honors pages strip (#1580)", () => {
  it("renders the four pages for a viewer who can open them and nothing for one page", () => {
    const full = renderToStaticMarkup(createElement(HonorsViewsStrip, { eventId: "e1", permissions: ["CONFIGURE_EVENT", "VIEW_REPORTS"], current: "classes" }));
    expect(full).toContain('aria-label="Honors Weekend pages"');
    for (const label of ["Classes", "Schedule board", "Instructors", "Rosters"]) expect(full).toContain(label);
    expect(renderToStaticMarkup(createElement(HonorsViewsStrip, { eventId: "e1", permissions: ["VIEW_REPORTS"], current: "rosters" }))).toBe("");
  });

  it("is on all four pages, including their restricted states, and the old back links and Tools menu are gone", () => {
    for (const path of ["page", "schedule/page", "instructors/page", "rosters/page"]) {
      const source = read(`app/(workspace)/more/honors/${path}.tsx`);
      expect(source, path).toContain("HonorsViewsStrip");
      expect(source, path).not.toContain("Back to classes");
      expect(source, path).not.toContain("Back to Honors Weekend classes");
    }
    const setup = read("components/honors-setup-workspace.tsx");
    expect(setup).not.toContain("tools={[");
    expect(read("components/honors-schedule-board.tsx")).not.toContain("duplicate-page-title");
  });
});

describe("Team results level strip (#1580)", () => {
  const html = renderToStaticMarkup(createElement(TeamResultsWorkspace, { eventId: "e1", level: "AREA", initialRows: [], levelTeams: [], levelInfo: [], canEdit: false }));

  it("shows the levels as a strip with counts and the same hrefs, and no duplicate Team results heading", () => {
    expect(html).toContain('aria-label="Level"');
    expect(html).toContain("Area (0)");
    expect(html).toContain("Conference (0)");
    expect(html).toContain("Union (0)");
    expect(html).toContain('href="/more/team-results?event=e1&amp;level=CONFERENCE"');
    expect(html).not.toContain("<h2");
  });

  it("keeps the download and print actions and hides the edit-only ones without canEdit", () => {
    expect(html).toContain("Download results CSV");
    expect(html).toContain("Print team forms");
    expect(html).not.toContain("Recompute who advances");
  });
});
