import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #1788 (Caleb, 2026-11-09): staff acting as an Area Coordinator see what a coordinator sees and may do exactly two
 * things that change data: email a club-form link, and change shared club report layouts. Every other coordinator
 * change needs the coordinator's own account. This pins that list, so a new change route under the coordinator's API
 * has to be added here on purpose. The two coordinator exports (#1760 roster, #1761 Monthly Records) are POST routes
 * that change no club data: they only read and write an audit entry, under the staff user and the act-as, so acting
 * staff may use them like the coordinator's other reads.
 */

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ currentStaffActingContext: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({}) }));
vi.mock("@/modules/organizations/staff-act-as", () => ({ currentStaffActingContext: mocks.currentStaffActingContext }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: async () => ({ account: null, via: null, sessionId: null }) }));
vi.mock("@/modules/attendee-accounts/sign-in-gate", () => ({ accountNeedsSecondStep: vi.fn() }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: vi.fn() }));

import { resolveAreaCoordinatorViewer } from "@/modules/club-forms/access";
import { requireAreaCoordinatorToggleActor } from "@/modules/event-modules/scoped-toggle";
import { currentAreaCoordinator } from "@/modules/organizations/area-coordinators";
import { currentTltDirector } from "@/modules/tlt-directory/access";
import { resolveCoordinatorReportActor } from "@/modules/reporting/club-report-api";

const API_ROOT = join(process.cwd(), "app/api/attendee/area-clubs");

/** Each coordinator route that changes data, the check it must use, and whether that check lets staff acting as a coordinator in. */
const WRITE_ROUTES: Record<string, { gate: string; actingStaff: "allowed" | "refused" }> = {
  "[organizationId]/forms/links/route.ts": { gate: "requireAreaCoordinatorViewer", actingStaff: "allowed" },
  "events/[eventId]/report-columns/route.ts": { gate: "resolveCoordinatorReportActor", actingStaff: "allowed" },
  "events/[eventId]/attendance-points/route.ts": { gate: "requireAreaCoordinatorPointsActor", actingStaff: "refused" },
  "events/[eventId]/debrief/route.ts": { gate: "requireAreaCoordinatorDebriefActor", actingStaff: "refused" },
  "events/[eventId]/budget/route.ts": { gate: "requireAreaCoordinatorBudgetToggleActor", actingStaff: "refused" },
  "events/[eventId]/budget/lines/route.ts": { gate: "requireAreaCoordinatorBudgetActor", actingStaff: "refused" },
  "events/[eventId]/club-teachers/route.ts": { gate: "requireAreaCoordinatorTeacherActor", actingStaff: "refused" },
  "events/[eventId]/event-scoring/route.ts": { gate: "requireAreaCoordinatorScoringActor", actingStaff: "refused" },
  "team-permissions/[permissionId]/route.ts": { gate: "currentAreaCoordinator", actingStaff: "refused" },
  // Exports (#1760, #1761): POST only for the cross-site check; they write only the audit log, never club data.
  "roster-export/route.ts": { gate: "resolveAreaCoordinatorViewer", actingStaff: "allowed" },
  "records-export/route.ts": { gate: "resolveAreaCoordinatorViewer", actingStaff: "allowed" },
  // The TLT directory (#1686): the TLT director's own account only; acting staff have no access at all, not even to read.
  "tlt-directory/profile/route.ts": { gate: "tltDirectorRequest", actingStaff: "refused" },
  "tlt-directory/lists/route.ts": { gate: "tltDirectorRequest", actingStaff: "refused" },
  "tlt-directory/export/route.ts": { gate: "tltDirectorRequest", actingStaff: "refused" },
  "tlt-directory/suggestion/route.ts": { gate: "tltDirectorRequest", actingStaff: "refused" },
};

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? routeFiles(path) : name === "route.ts" ? [path] : [];
  });
}

const acting = { userId: "u-staff", staffSessionId: "s-1", actAsId: "act-1", role: "AREA_COORDINATOR" as const, organizationId: null, expiresAt: new Date("2026-11-09T20:00:00.000Z") };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentStaffActingContext.mockResolvedValue(acting);
});

describe("what staff acting as an Area Coordinator may change", () => {
  it("lists every coordinator route that changes data", () => {
    const writes = routeFiles(API_ROOT)
      .filter((path) => /export (const|async function|function) (POST|PUT|PATCH|DELETE)\b/.test(readFileSync(path, "utf8")))
      .map((path) => relative(API_ROOT, path).split("\\").join("/"))
      .sort();
    expect(writes).toEqual(Object.keys(WRITE_ROUTES).sort());
  });

  it.each(Object.entries(WRITE_ROUTES))("%s uses its expected check", (file, { gate }) => {
    const source = readFileSync(join(API_ROOT, file), "utf8");
    expect(source).toContain(`await ${gate}(`);
    // No route reads the act-as itself: the named check is the only way in.
    expect(source).not.toContain("currentStaffActingContext");
  });

  it("allows exactly the club-form link email, the shared report layouts and the two audited exports", () => {
    const allowed = Object.entries(WRITE_ROUTES).filter(([, route]) => route.actingStaff === "allowed").map(([file]) => file);
    expect(allowed).toEqual(["[organizationId]/forms/links/route.ts", "events/[eventId]/report-columns/route.ts", "roster-export/route.ts", "records-export/route.ts"]);
  });

  it("lets acting staff send a club-form link, recorded under the staff user and the act-as", async () => {
    expect(await resolveAreaCoordinatorViewer()).toEqual({ kind: "AREA_COORDINATOR", actor: { kind: "STAFF_ACTING", userId: "u-staff", actAsId: "act-1" } });
  });

  it("lets acting staff change shared report layouts, recorded under the staff user and the act-as", async () => {
    expect(await resolveCoordinatorReportActor()).toEqual({ kind: "act-as", userId: "u-staff", actAsId: "act-1" });
  });

  it("keeps the Clubs Administrator marker on both", async () => {
    mocks.currentStaffActingContext.mockResolvedValue({ ...acting, viaClubsAdministrator: true });
    expect(await resolveAreaCoordinatorViewer()).toMatchObject({ actor: { viaClubsAdministrator: true } });
    expect(await resolveCoordinatorReportActor()).toMatchObject({ viaClubsAdministrator: true });
  });

  it("refuses acting staff on the tool switches and team permission decisions", async () => {
    // Club teachers, camporee scoring and attendance points all go through this one check.
    await expect(requireAreaCoordinatorToggleActor()).rejects.toMatchObject({ code: "NOT_AVAILABLE" });
    expect(await currentAreaCoordinator()).toBeNull();
  });

  it("gives acting staff no access to the TLT directory", async () => {
    expect(await currentTltDirector()).toBeNull();
  });

  it("allows nothing when the act-as is for a club director or has ended", async () => {
    mocks.currentStaffActingContext.mockResolvedValue({ ...acting, role: "CLUB_DIRECTOR", organizationId: "org-1" });
    expect(await resolveAreaCoordinatorViewer()).toBeNull();
    expect(await resolveCoordinatorReportActor()).toBeNull();
    mocks.currentStaffActingContext.mockResolvedValue(null);
    expect(await resolveAreaCoordinatorViewer()).toBeNull();
    expect(await resolveCoordinatorReportActor()).toBeNull();
  });
});
