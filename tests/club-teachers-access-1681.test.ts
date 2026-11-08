import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

/**
 * #1681: the Area Coordinator's one new write is narrow. These read the source so a later edit that widens it fails here;
 * `scripts/verify-club-teachers.ts` proves the behavior against a real database.
 */
describe("club teachers access (#1681)", () => {
  // The switching itself moved to the shared helper (#1676); the teacher rule stays in settings.ts. Both are read as one.
  const settings = read("modules/club-teachers/settings.ts") + read("modules/event-modules/scoped-toggle.ts");
  const acRoute = read("app/api/attendee/area-clubs/events/[eventId]/club-teachers/route.ts");
  const staffRoute = read("app/api/events/[eventId]/club-teachers/route.ts");
  const moduleService = read("modules/event-modules/service.ts");

  it("leaves the system-administrator-only module service as it was", () => {
    expect(moduleService).toContain("Only a system administrator can turn event modules on or off.");
    expect(moduleService).not.toContain("club-teachers");
    expect(moduleService).not.toContain("area-coordinator");
  });

  it("lets an Area Coordinator through only with a real grant and the second sign-in step", () => {
    expect(acRoute).toContain("requireAreaCoordinatorTeacherActor");
    expect(settings).toContain("currentAreaCoordinator()");
    expect(settings).toContain("isAreaCoordinator(actor.accountId)");
  });

  it("changes only the one scoped module, on club events, and audits each switch", () => {
    expect(settings).toContain("scopedToggleModuleKeys.includes(moduleKey)");
    expect(settings).toContain('audience: "CLUB"');
    expect(settings).toContain("EVENT_MODULE_ENABLED");
    expect(settings).toContain("EVENT_MODULE_DISABLED");
    expect(settings).toContain("CLUB_TEACHER_RULE_SET");
    expect(settings).toContain("viaAreaCoordinator");
  });

  it("gives staff the system administrator / Event Admin check (so a Registration Manager cannot), and the request origin check", () => {
    expect(settings).toContain('access.membership?.role !== "EVENT_ADMIN"');
    expect(settings).not.toContain("MANAGE_REGISTRATION");
    expect(staffRoute).toContain("rejectCrossOriginRequest");
    expect(acRoute).toContain("rejectCrossOriginRequest");
  });

  it("never lets a coordinator require teachers or change the stored value", () => {
    expect(settings).toContain('input.rule?.requireTeachers === true');
    expect(settings).toContain('"NOT_PERMITTED"');
    expect(settings).toContain('actor.kind === "staff" ? { ...numbers, requireTeachers } : numbers');
  });

  it("blocks a registration only through the one check that does nothing unless the tool is on and set to require", () => {
    const repository = read("modules/club-teachers/repository.ts");
    expect(repository).toContain("if (!rule || !rule.requireTeachers) return;");
    expect(read("modules/club-registrations/repository.ts")).toContain("assertTeachersMeetRule(eventId, organizationId");
  });

  it("tells staff when a coordinator turns the tool on with require stored on, through the #1483 alert path, and audits it (#1727)", () => {
    expect(settings).toContain('dispatchUnsuppressedAlert');
    expect(settings).toContain('actor.kind === "area-coordinator" && input.enabled === true && !wasOn');
    expect(settings).toContain("if (!rule?.requireTeachers) return;");
    expect(settings).toContain("CLUB_TEACHER_REQUIRE_NOTICE_SENT");
    // The stored value is never changed by the notice.
    expect(settings.slice(settings.indexOf("async function notifyRequireBackOn"))).not.toContain("clubTeacherRule.update");
  });
});
