import { describe, expect, it } from "vitest";
import {
  canTeach,
  defaultTeacherRule,
  requiredTeachers,
  teacherAgeUnknownLabel,
  teacherEligibility,
  teacherEligibilityLabel,
  teacherEntriesSchema,
  teacherUnderAgeLabel,
  youngestTeacherAge,
  teacherRuleSchema,
  teacherRuleSummary,
  teacherSettingsSchema,
  teacherStatus,
  teacherWarning,
} from "@/modules/club-teachers/domain";
import { defaultModuleKeys, creationModuleKeys, scopedToggleModuleKeys, eventModuleDefinition } from "@/modules/event-modules/catalog";

const rule = { baseTeachers: 1, largerClubOver: 10, largerClubTeachers: 2, requireTeachers: false };

describe("club teachers rule (#1681)", () => {
  it("asks for the base number, and the larger number only above N", () => {
    expect(requiredTeachers(rule, 0)).toBe(1);
    expect(requiredTeachers(rule, 10)).toBe(1);
    expect(requiredTeachers(rule, 11)).toBe(2);
    expect(requiredTeachers(defaultTeacherRule, 60)).toBe(1);
  });

  it("never asks a larger club for fewer than any club", () => {
    expect(requiredTeachers({ ...rule, baseTeachers: 3, largerClubTeachers: 2 }, 50)).toBe(3);
    expect(teacherRuleSchema.safeParse({ ...rule, baseTeachers: 3, largerClubTeachers: 2 }).success).toBe(false);
  });

  it("reports how many a club is short and says so plainly, without blocking by default", () => {
    const short = teacherStatus(rule, 12, 1);
    expect(short).toEqual({ required: 2, named: 1, short: 1, met: false });
    expect(teacherWarning(short, false)).toContain("You can still register");
    expect(teacherWarning(short, true)).toContain("before you submit");
    expect(teacherWarning(teacherStatus(rule, 12, 2), false)).toBeNull();
    expect(teacherWarning(teacherStatus(rule, 12, 5), true)).toBeNull();
  });

  it("describes the rule in words", () => {
    expect(teacherRuleSummary(defaultTeacherRule)).toBe("1 teacher per club");
    expect(teacherRuleSummary(rule)).toBe("1 teacher per club, 2 for a club bringing more than 10 people");
  });

  it("validates what the person turning it on sends", () => {
    expect(teacherSettingsSchema.safeParse({}).success).toBe(false);
    expect(teacherSettingsSchema.safeParse({ enabled: true }).success).toBe(true);
    expect(teacherSettingsSchema.safeParse({ rule }).success).toBe(true);
    expect(teacherSettingsSchema.safeParse({ enabled: true, extra: 1 }).success).toBe(false);
    expect(teacherRuleSchema.safeParse({ ...rule, baseTeachers: 1.5 }).success).toBe(false);
    expect(teacherRuleSchema.safeParse({ ...rule, largerClubOver: 0 }).success).toBe(false);
    expect(teacherRuleSchema.safeParse({ ...rule, baseTeachers: 99 }).success).toBe(false);
  });

  it("lets only adults and staff teach, each person once", () => {
    expect(canTeach("ADULT")).toBe(true);
    expect(canTeach("STAFF")).toBe(true);
    expect(canTeach("YOUTH")).toBe(false);
    expect(canTeach("UNDERAGE")).toBe(false);
    const ok = teacherEntriesSchema.safeParse({ teachers: [{ rosterMemberId: "a", honorName: " Knots ", locationId: "" }] });
    expect(ok.success && ok.data.teachers[0]).toEqual({ rosterMemberId: "a", honorName: "Knots", locationId: null });
    expect(teacherEntriesSchema.safeParse({ teachers: [{ rosterMemberId: "a" }, { rosterMemberId: "a" }] }).success).toBe(false);
    // Nothing but the id, an honor and a site is accepted: no names or ages come from the browser.
    expect(teacherEntriesSchema.safeParse({ teachers: [{ rosterMemberId: "a", name: "Pat Sample" }] }).success).toBe(false);
  });
});

describe("club teachers module (#1681)", () => {
  it("is off by default for a new club event and in the creation step, and applies to club events", () => {
    expect(defaultModuleKeys("CLUB")).not.toContain("club-teachers");
    expect(defaultModuleKeys("GENERAL")).not.toContain("club-teachers");
    expect(creationModuleKeys("CLUB")).not.toContain("club-teachers");
    expect(creationModuleKeys("CLUB", ["club-teachers"])).toContain("club-teachers");
    expect(creationModuleKeys("GENERAL", ["club-teachers"])).not.toContain("club-teachers");
    expect(eventModuleDefinition("club-teachers").alwaysOn).toBe(false);
  });

  it("is one of the only modules the scoped (Area Coordinator) path may switch (Camporee scoring #1676 and Attendance points #1677 are the others)", () => {
    expect(scopedToggleModuleKeys).toEqual(["club-teachers", "event-scoring", "attendance-points"]);
  });
});

describe("club teachers must be 18 or older (#1727)", () => {
  it("refuses 16 and 17 and accepts 18 and over", () => {
    expect(youngestTeacherAge).toBe(18);
    expect(teacherEligibility(16)).toBe("under-18");
    expect(teacherEligibility(17)).toBe("under-18");
    expect(teacherEligibility(18)).toBe("ok");
    expect(teacherEligibility(45)).toBe("ok");
  });

  it("treats an unknown age as not eligible and says why", () => {
    expect(teacherEligibility(null)).toBe("age-unknown");
    expect(teacherEligibilityLabel("age-unknown")).toBe(teacherAgeUnknownLabel);
  });

  it("labels someone under 18 plainly and leaves an eligible teacher unlabelled", () => {
    expect(teacherEligibilityLabel("under-18")).toBe(teacherUnderAgeLabel);
    expect(teacherUnderAgeLabel).toBe("Under 18, can't teach");
    expect(teacherEligibilityLabel("ok")).toBeNull();
  });
});
