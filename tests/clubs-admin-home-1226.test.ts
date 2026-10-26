import { describe, expect, it } from "vitest";
import { summarizeClub, type AreaSummaryInput } from "@/modules/club-reports/area-summary-domain";
import {
  NEW_CLUBS_LIMIT,
  REGISTERED_CLUBS_LIMIT,
  buildClubsAdminHome,
  chooseReportMonth,
  clubYearOptions,
  clubsAdminHrefs,
  clubsAdminTabs,
  pickNextEvent,
  recordStatusLabels,
  type ClubsAdminApplicationSource,
  type ClubsAdminEventSource,
} from "@/modules/club-reports/clubs-admin-home-model";

/** #1226: the Clubs Administrator dashboard model. Synthetic data only. */
const now = new Date("2026-10-26T18:00:00.000Z");
const clubYear = "2026-27";

function club(id: string, name: string, reports: AreaSummaryInput["reports"], overrides: Partial<AreaSummaryInput> = {}, at = now, year = clubYear) {
  return summarizeClub({
    id, name, church: `${name} Church`, directors: [], rosterSize: 10, registrationOnTime: true,
    backgroundChecks: { missing: 0, notInCompliance: 0, expiringSoon: 0 }, reports, ...overrides,
  }, year, at);
}
const submitted = (reportMonth: string, onTimePoints = 50) => ({ reportMonth, status: "SUBMITTED" as const, totalPoints: 60, onTimePoints });

const clubs = [
  club("c1", "Alpha Pathfinders", [submitted("2026-10")], { rosterSize: 12 }),
  club("c2", "Beta Adventurers", [submitted("2026-10", 0)], { rosterSize: 8 }),
  club("c3", "Gamma Pathfinders", [{ reportMonth: "2026-10", status: "DRAFT", totalPoints: 0, onTimePoints: 0 }], { rosterSize: 5 }),
  club("c4", "Delta Explorers", [], { rosterSize: 0 }),
];

const event = (id: string, name: string, startsAt: string, rows: Array<[string, ClubsAdminEventSource["clubs"][number]["status"], number | null]> = []): ClubsAdminEventSource => ({
  id, name, startsAt, clubs: rows.map(([organizationId, status, headcount]) => ({ organizationId, name: organizationId, status, headcount })),
});

function application(id: string, submittedAt: string, overrides: Partial<ClubsAdminApplicationSource> = {}): ClubsAdminApplicationSource {
  return {
    id, status: "PENDING", clubName: `Club ${id}`, submittedAt, otherBoardMembers: [],
    church: { name: `Church ${id}`, needsChoice: false }, director: { email: `${id}@example.test` }, ...overrides,
  };
}

const base = { clubYear, now, clubs, events: [] as ClubsAdminEventSource[], applications: [] as ClubsAdminApplicationSource[], waitingCount: 0 };

describe("counts", () => {
  it("counts every club, submitted and late records for the report month, and roster members", () => {
    const home = buildClubsAdminHome(base);
    expect(home.counts.activeClubs).toBe(4);
    // Alpha submitted on time, Beta late; a draft and no record do not count.
    expect(home.counts.monthlyRecordsSubmitted).toBe(2);
    expect(home.rosterMembers).toBe(25);
    expect(home.reportMonth).toBe("2026-10");
    expect(home.reportMonthLabel).toBe("October 2026");
  });

  it("takes the waiting count from the count read, not the list", () => {
    expect(buildClubsAdminHome({ ...base, waitingCount: 7 }).counts.waitingApplications).toBe(7);
  });

  it("uses the last month of a past club year as the report month", () => {
    const past = "2024-25";
    const pastClubs = [
      club("p1", "Alpha", [submitted("2025-08"), submitted("2024-10")], {}, now, past),
      club("p2", "Beta", [submitted("2025-07")], {}, now, past),
    ];
    expect(chooseReportMonth(past, now)).toBe("2025-08");
    const home = buildClubsAdminHome({ ...base, clubYear: past, clubs: pastClubs });
    expect(home.reportMonthLabel).toBe("August 2025");
    expect(home.counts.monthlyRecordsSubmitted).toBe(1);
  });

  it("uses the current month when it is in the selected year, and the last month for a future year", () => {
    expect(chooseReportMonth("2026-27", now)).toBe("2026-10");
    expect(chooseReportMonth("2027-28", now)).toBe("2028-08");
  });
});

describe("next club event", () => {
  const rows: Array<[string, "REGISTERED" | "NOT_REGISTERED" | "WAITLISTED" | "DRAFT" | "CANCELLED", number | null]> = [
    ["c1", "REGISTERED", 20], ["c2", "REGISTERED", 11], ["c3", "WAITLISTED", 9], ["c4", "NOT_REGISTERED", null],
  ];

  it("picks the first event on or after today (Central) and skips earlier ones", () => {
    const events = [
      event("old", "Old Camporee", "2026-10-25T23:00:00.000Z", rows),
      event("today", "Today Rally", "2026-10-26T15:00:00.000Z", rows),
      event("later", "Later Fest", "2027-03-01T00:00:00.000Z", rows),
    ];
    expect(pickNextEvent(events, now)?.id).toBe("today");
    expect(pickNextEvent([events[0]!], now)).toBeNull();
  });

  it("compares Central calendar dates: an evening-Central event today still counts, yesterday's does not", () => {
    // 2026-10-27T02:00Z is 9 pm Central on Oct 26, the same day as "now" (1 pm Central).
    const evening = event("eve", "Evening Rally", "2026-10-27T02:00:00.000Z");
    const yesterday = event("yd", "Yesterday", "2026-10-26T04:00:00.000Z");
    expect(pickNextEvent([yesterday, evening], now)?.id).toBe("eve");
    // Late evening Central on Oct 26 (UTC already Oct 27): "now" is still the 26th there.
    expect(pickNextEvent([evening], new Date("2026-10-27T03:30:00.000Z"))?.id).toBe("eve");
    expect(pickNextEvent([evening], new Date("2026-10-27T06:00:00.000Z"))).toBeNull();
  });

  it("shows registered of every active club and the headcount of registered clubs only", () => {
    const home = buildClubsAdminHome({ ...base, events: [event("e1", "Fall Camporee", "2026-11-14T15:00:00.000Z", rows)] });
    expect(home.nextEvent).toEqual({ id: "e1", name: "Fall Camporee", dateLabel: "November 14, 2026", registeredClubs: 2, totalClubs: 4, people: 31 });
  });

  it("is null with no upcoming event", () => {
    expect(buildClubsAdminHome(base).nextEvent).toBeNull();
    expect(buildClubsAdminHome({ ...base, events: [event("e0", "Past", "2026-09-05T15:00:00.000Z")] }).nextEvent).toBeNull();
  });
});

describe("new clubs", () => {
  it("lists pending applications only, oldest first, with the review link", () => {
    const applications = [
      application("b", "2026-10-20T15:00:00.000Z", { otherBoardMembers: ["One", "Two", "Three"] }),
      application("a", "2026-10-10T15:00:00.000Z", { otherBoardMembers: ["Solo"] }),
      application("x", "2026-10-01T15:00:00.000Z", { status: "APPROVED" }),
      application("y", "2026-10-02T15:00:00.000Z", { status: "DECLINED" }),
    ];
    const home = buildClubsAdminHome({ ...base, applications, waitingCount: 2 });
    expect(home.newClubs.map((item) => item.id)).toEqual(["a", "b"]);
    expect(home.newClubs[0]).toMatchObject({ boardMembersLabel: "1 board member listed", submittedLabel: "Oct 10, 2026", reviewHref: "/admin/clubs/applications#application-a" });
    expect(home.newClubs[1]!.boardMembersLabel).toBe("3 board members listed");
    expect(home.moreNewClubs).toBe(false);
  });

  it("lists review-first reasons and none for a clean application", () => {
    const flagged = application("f", "2026-10-10T15:00:00.000Z", { duplicates: [1], invitedEmailDiffers: true, sterling: "NOT_COMPLIANT", sterlingAmbiguous: true, sterlingNameMismatch: true, church: { name: "C", needsChoice: true } });
    const home = buildClubsAdminHome({ ...base, applications: [flagged, application("ok", "2026-10-11T15:00:00.000Z", { sterling: "CLEAR", duplicates: [] })], waitingCount: 2 });
    expect(home.newClubs[0]!.reviewReasons).toHaveLength(6);
    expect(home.newClubs[1]!.reviewReasons).toEqual([]);
  });

  it("omits the board line when none are listed and flags a church that needs a choice", () => {
    const home = buildClubsAdminHome({ ...base, applications: [application("a", "2026-10-10T15:00:00.000Z", { church: { name: "Typed Church", needsChoice: true } })], waitingCount: 1 });
    expect(home.newClubs[0]).toMatchObject({ boardMembersLabel: null, needsChurchChoice: true });
  });

  it("shows at most five and says there are more", () => {
    const applications = Array.from({ length: 8 }, (_, index) => application(`app-${index}`, `2026-10-0${index + 1}T15:00:00.000Z`));
    const home = buildClubsAdminHome({ ...base, applications, waitingCount: 8 });
    expect(home.newClubs).toHaveLength(NEW_CLUBS_LIMIT);
    expect(home.newClubs[0]!.id).toBe("app-0");
    expect(home.moreNewClubs).toBe(true);
  });
});

describe("registered clubs", () => {
  it("labels this month's record for each club", () => {
    const home = buildClubsAdminHome(base);
    expect(home.registeredClubs.rows.map((row) => [row.name, row.recordLabel, row.rosterSize])).toEqual([
      ["Alpha Pathfinders", "Submitted", 12],
      ["Beta Adventurers", "Submitted late", 8],
      ["Gamma Pathfinders", "Draft", 5],
      ["Delta Explorers", "Due", 0],
    ]);
    expect(recordStatusLabels).toMatchObject({ MISSING: "Not submitted", FUTURE: "Not yet due" });
  });

  it("filters by name or church and keeps the total", () => {
    const home = buildClubsAdminHome({ ...base, query: "path" });
    expect(home.registeredClubs.rows.map((row) => row.id)).toEqual(["c1", "c3"]);
    expect(home.registeredClubs.matchCount).toBe(2);
    expect(home.registeredClubs.total).toBe(4);
    expect(buildClubsAdminHome({ ...base, query: "zzz" }).registeredClubs.rows).toEqual([]);
  });

  it("shows the first ten", () => {
    const many = Array.from({ length: 14 }, (_, index) => club(`m${index}`, `Club ${String(index).padStart(2, "0")}`, []));
    const home = buildClubsAdminHome({ ...base, clubs: many });
    expect(home.registeredClubs.rows).toHaveLength(REGISTERED_CLUBS_LIMIT);
    expect(home.registeredClubs.total).toBe(14);
  });
});

describe("tabs, links and years", () => {
  it("carries the club year on every year link", () => {
    const href = clubsAdminHrefs(clubYear);
    expect(href.summary).toBe("/admin/clubs/summary?year=2026-27");
    expect(href.points).toBe("/admin/clubs/summary?year=2026-27#points");
    expect(clubsAdminTabs(clubYear, 3).map((tab) => [tab.label, tab.href])).toEqual([
      ["Overview", "/admin/clubs?year=2026-27"],
      ["All clubs", "/admin/clubs/summary?year=2026-27"],
      ["Monthly Records", "/admin/clubs/reports?year=2026-27"],
      ["Points", "/admin/clubs/summary?year=2026-27#points"],
      ["Club events", "/admin/clubs/summary?year=2026-27#club-events"],
      ["Forms", "/admin/club-forms"],
      ["New clubs (3)", "/admin/clubs/applications"],
    ]);
  });

  it("offers the current club year and the three before it, plus an odd selected year", () => {
    expect(clubYearOptions("2026-27", now)).toEqual(["2026-27", "2025-26", "2024-25", "2023-24"]);
    expect(clubYearOptions("2019-20", now)).toContain("2019-20");
  });
});
