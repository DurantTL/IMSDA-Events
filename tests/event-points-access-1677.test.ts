import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

/**
 * #1677: Attendance points reuses the narrow Area Coordinator switch from #1681 and adds no wider write. These read the
 * source so a later edit that widens it fails here; `scripts/verify-attendance-points.ts` proves the behavior against a
 * real database.
 */
describe("attendance points access (#1677)", () => {
  const service = read("modules/event-points/service.ts");
  const acRoute = read("app/api/attendee/area-clubs/events/[eventId]/attendance-points/route.ts");
  const staffRoute = read("app/api/events/[eventId]/attendance-points/route.ts");

  it("leaves the system-administrator-only module service as it was", () => {
    const moduleService = read("modules/event-modules/service.ts");
    expect(moduleService).not.toContain("attendance-points");
    expect(moduleService).not.toContain("area-coordinator");
  });

  it("switches the module only through the shared helper, and lists it among the scoped modules", () => {
    expect(service).toContain("writeScopedModuleSwitch");
    expect(service).toContain("assertScopedToggleAllowed");
    expect(service).not.toContain("eventModule.create");
    expect(service).not.toContain("eventModule.delete");
    expect(read("modules/event-modules/catalog.ts")).toContain('["club-teachers", "event-scoring", "attendance-points", "debrief", "event-budget"]');
  });

  it("checks the request origin and a real coordinator grant on the coordinator route", () => {
    expect(acRoute).toContain("rejectCrossOriginRequest");
    expect(acRoute).toContain("requireAreaCoordinatorPointsActor");
    expect(staffRoute).toContain("rejectCrossOriginRequest");
    expect(staffRoute).toContain("requireStaffPointsAccess");
  });

  it("gives an Area Coordinator no names, marking, override, apply or undo", () => {
    expect(service).toContain("{ canSwitch: true, canSetUp: true, canSeeNames: false, canMark: false, canOverride: false, canApply: false }");
    expect(service).toContain("{ canSwitch: true, canSetUp: true, canSeeNames: true, canMark: true, canOverride: true, canApply: true }");
    expect(service).toContain("capabilities.canSeeNames");
  });

  it("limits the staff side to administrators (no Registration Manager)", () => {
    expect(service).toContain("return requireStaffToggleAccess(session, eventId, lookup);");
    expect(read("modules/event-modules/scoped-toggle.ts")).toContain('access.membership?.role !== "EVENT_ADMIN"');
  });

  it("audits apply, undo, override, mark and settings, with ids and numbers only", () => {
    for (const action of ["ATTENDANCE_POINTS_APPLIED", "ATTENDANCE_POINTS_UNDONE", "ATTENDANCE_POINTS_OVERRIDE_SET", "ATTENDANCE_POINTS_OVERRIDE_REMOVED", "ATTENDANCE_POINTS_CHILD_MARKED", "ATTENDANCE_POINTS_SETTINGS_SAVED"]) {
      expect(service).toContain(action);
    }
    expect(service).toContain("no club or person name, and no override reason, is written to the audit log");
  });

  it("applies in one transaction guarded by the applied marker, and never touches Monthly Records", () => {
    expect(service).toContain("updateMany({ where: { eventId, appliedAt: null }");
    expect(service).not.toContain("clubMonthlyReport");
    expect(service).not.toContain("clubYearStanding");
  });
});
