import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

/**
 * #1676: Camporee scoring reuses the narrow Area Coordinator switch from #1681 and adds no wider write. These read the
 * source so a later edit that widens it fails here; `scripts/verify-camporee-scoring.ts` proves the behavior against a
 * real database.
 */
describe("camporee scoring access (#1676)", () => {
  const service = read("modules/camporee-scoring/service.ts");
  const helper = read("modules/event-modules/scoped-toggle.ts");
  const acRoute = read("app/api/attendee/area-clubs/events/[eventId]/camporee-scoring/route.ts");
  const staffRoute = read("app/api/events/[eventId]/camporee-scoring/route.ts");

  it("leaves the system-administrator-only module service as it was", () => {
    const moduleService = read("modules/event-modules/service.ts");
    expect(moduleService).not.toContain("camporee");
    expect(moduleService).not.toContain("area-coordinator");
  });

  it("switches the module only through the shared helper", () => {
    expect(service).toContain("writeScopedModuleSwitch");
    expect(service).toContain("assertScopedToggleAllowed");
    expect(service).not.toContain("eventModule.create");
    expect(service).not.toContain("eventModule.delete");
    expect(helper).toContain("scopedToggleModuleKeys.includes(moduleKey)");
    expect(helper).toContain("isAreaCoordinator(actor.accountId)");
    expect(helper).toContain("currentAreaCoordinator()");
    expect(helper).toContain('audience: "CLUB"');
    expect(helper).toContain('access.membership?.role !== "EVENT_ADMIN"');
  });

  it("checks the request origin and a real coordinator grant on the coordinator route", () => {
    expect(acRoute).toContain("rejectCrossOriginRequest");
    expect(acRoute).toContain("requireAreaCoordinatorScoringActor");
    expect(staffRoute).toContain("rejectCrossOriginRequest");
    expect(staffRoute).toContain("requireStaffScoringAccess");
  });

  it("never lets a coordinator or a registration manager publish, and keeps publishing audited", () => {
    expect(service).toContain('{ canSwitch: true, canDefine: true, canEnter: true, canPublish: false, canCorrectAfterPublish: false }');
    expect(service).toContain("{ canSwitch: false, canDefine: false, canEnter: true, canPublish: false, canCorrectAfterPublish: false }");
    expect(service).toContain("CAMPOREE_RESULTS_PUBLISHED");
    expect(service).toContain("CAMPOREE_SCORE_CORRECTED_AFTER_PUBLISH");
  });

  it("writes no name to the audit log and reads a director's club from the verified portal access", () => {
    expect(service).toContain("Ids and numbers only");
    const page = read("app/(public)/account/(portal)/clubs/[organizationId]/events/[eventId]/page.tsx");
    expect(page).toContain("loadDirectorCamporeeResultsOrNull(organizationId, eventId)");
  });

  it("does not touch club points", () => {
    expect(service).not.toMatch(/points/i);
  });
});
