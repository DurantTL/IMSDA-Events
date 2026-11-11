import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { carriedClassLevel, carriedIsTlt, carryForwardInputSchema } from "@/modules/club-rosters/carry-forward-domain";
import { parseRosterCsv } from "@/modules/club-rosters/csv-import";
import {
  clubClassLevelLabels,
  clubClassLevels,
  effectiveClassLevel,
  rosterClassLevels,
  rosterIsTltFor,
  rosterTltCell,
} from "@/modules/club-rosters/domain";
import { rosterMemberInputSchema, rosterMemberUpdateSchema } from "@/modules/club-rosters/schemas";
import { classLevelFrom, rosterClassFrom } from "@/modules/club-imports/domain";
import { clubImportItemSchema } from "@/modules/club-imports/schemas";
import { clubFormTemplateSeeds } from "@/modules/club-forms/definitions";
import { rosterPrefillFromAnswers } from "@/modules/club-forms/roster-mapping";
import { rosterRolePrefill } from "@/modules/club-registrations/domain";
import { prefillFromRoster } from "@/modules/club-reports/year-end-domain";
import { attendanceGroupOf, countsFromAttendance } from "@/modules/club-meeting-notes/attendance";
import { teamRoleFor } from "@/modules/club-teams/rules";
import { requirementGaps } from "@/modules/honors/enrollment-domain";
import { INSIGNIA_SETS } from "@/modules/earned-awards/domain";

/** TLT is a yes/no on youth roster members, not a current class (#1851). Synthetic data only. */

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

const input = { firstName: "Ana", lastName: "Sample", birthDate: "2010-04-17", attendeeType: "YOUTH" as const, gender: "FEMALE" as const };

describe("class list", () => {
  it("adds Basic Staff Training between TLT and Master Guide, and keeps TLT for history", () => {
    expect(clubClassLevels.slice(-3)).toEqual(["TLT", "BASIC_STAFF_TRAINING", "MASTER_GUIDE"]);
    expect(clubClassLevelLabels.BASIC_STAFF_TRAINING).toBe("Basic Staff Training");
    expect(clubClassLevelLabels.TLT).toBe("TLT");
    expect(INSIGNIA_SETS.BASIC_STAFF_TRAINING).toEqual([]);
  });

  it("offers TLT nowhere in the roster's current class choices", () => {
    expect(rosterClassLevels).not.toContain("TLT");
    expect(rosterClassLevels).toContain("BASIC_STAFF_TRAINING");
  });
});

describe("roster write schema", () => {
  it("accepts the flag and Basic Staff Training, and refuses TLT as a current class", () => {
    expect(rosterMemberInputSchema.parse({ ...input, isTlt: true, classLevel: "BASIC_STAFF_TRAINING" })).toMatchObject({ isTlt: true, classLevel: "BASIC_STAFF_TRAINING" });
    expect(rosterMemberInputSchema.safeParse({ ...input, classLevel: "TLT" }).success).toBe(false);
    expect(rosterMemberUpdateSchema.parse({ isTlt: false })).toEqual({ isTlt: false });
    expect(rosterMemberUpdateSchema.safeParse({ classLevel: "TLT" }).success).toBe(false);
  });

  it("keeps the flag only for a youth", () => {
    expect(rosterIsTltFor("YOUTH", true)).toBe(true);
    expect(rosterIsTltFor("YOUTH", false)).toBe(false);
    expect(rosterIsTltFor("YOUTH", undefined)).toBe(false);
    for (const type of ["STAFF", "ADULT", "UNDERAGE"]) expect(rosterIsTltFor(type, true)).toBe(false);
  });
});

describe("carry forward", () => {
  it("carries the flag for a youth, lets the director change it, and drops it for anyone else", () => {
    expect(carriedIsTlt({ isTlt: true }, { attendeeType: "YOUTH" })).toBe(true);
    expect(carriedIsTlt({ isTlt: true }, { attendeeType: "YOUTH", isTlt: false })).toBe(false);
    expect(carriedIsTlt({ isTlt: true }, { attendeeType: "STAFF" })).toBe(false);
    expect(carriedIsTlt({ isTlt: true }, { attendeeType: "ADULT", isTlt: true })).toBe(false);
  });

  it("never carries TLT as a class, and accepts Basic Staff Training", () => {
    expect(carriedClassLevel({ classLevel: "TLT" }, { attendeeType: "YOUTH" })).toBeNull();
    expect(carriedClassLevel({ classLevel: "GUIDE" }, { attendeeType: "YOUTH" })).toBe("GUIDE");
    const person = { memberId: "m1", attendeeType: "YOUTH" as const };
    const base = { confirm: true as const };
    expect(carryForwardInputSchema.safeParse({ ...base, people: [{ ...person, classLevel: "BASIC_STAFF_TRAINING", isTlt: true }] }).success).toBe(true);
    expect(carryForwardInputSchema.safeParse({ ...base, people: [{ ...person, classLevel: "TLT" }] }).success).toBe(false);
  });
});

describe("import", () => {
  it("reads a TLT class as the flag with the class left blank", () => {
    expect(rosterClassFrom("TLT")).toEqual({ classLevel: null, isTlt: true });
    expect(rosterClassFrom("Teen Leadership Training")).toEqual({ classLevel: null, isTlt: true });
    expect(rosterClassFrom("Guide")).toEqual({ classLevel: "GUIDE", isTlt: false });
    expect(rosterClassFrom("Adventurer")).toBeNull();
  });

  it("knows Basic Staff Training and BST", () => {
    expect(classLevelFrom("Basic Staff Training")).toBe("BASIC_STAFF_TRAINING");
    expect(classLevelFrom("BST")).toBe("BASIC_STAFF_TRAINING");
  });

  it("has no TLT class in the confirm payload, only the flag", () => {
    const person = { firstName: "Ana", lastName: "Sample", attendeeType: "YOUTH", role: "", classLevel: null, reportedAge: 15 };
    const item = { kind: "REGISTRATION", sourceKey: "form-89:k1", entryId: "1", clubYear: "2026-27", clubName: "Sample Pathfinders", churchId: null, invites: [] };
    expect(clubImportItemSchema.safeParse({ ...item, people: [{ ...person, isTlt: true }] }).success).toBe(true);
    expect(clubImportItemSchema.safeParse({ ...item, people: [{ ...person, classLevel: "TLT" }] }).success).toBe(false);
  });

  it("reads a TLT class cell or a TLT column from a roster CSV as the flag", () => {
    const csv = "First name,Last name,Birth date,Type,Class,TLT\nAna,Sample,2010-04-17,Youth,TLT,\nBen,Sample,2010-05-17,Youth,Guide,Yes\nCy,Sample,2010-06-17,Youth,Guide,No\n";
    const rows = parseRosterCsv(csv, 2026);
    expect(rows[0]).toMatchObject({ isTlt: true });
    expect(rows[0]!.classLevel).toBeUndefined();
    expect(rows[1]).toMatchObject({ isTlt: true, classLevel: "GUIDE" });
    expect(rows[2]).toMatchObject({ isTlt: false, classLevel: "GUIDE" });
    expect(rows.every((row) => row.problems.length === 0)).toBe(true);
  });
});

describe("form roster mapping", () => {
  const seed = clubFormTemplateSeeds.find((candidate) => candidate.key === "pathfinder_membership_application")!;
  const spec = { definition: seed.definition, sensitiveFieldKeys: seed.sensitiveFieldKeys, birthDateFieldKeys: seed.birthDateFieldKeys, hiddenFieldKeys: [] as string[] };

  it("reads a TLT class answer as the flag with the class left blank, for a youth", () => {
    expect(rosterPrefillFromAnswers(seed.rosterMapping!, { full_name: "Ana Sample", ay_class: "TLT" }, spec)).toMatchObject({ classLevel: null, isTlt: true });
    expect(rosterPrefillFromAnswers(seed.rosterMapping!, { full_name: "Ana Sample", ay_class: "Guide" }, spec)).toMatchObject({ classLevel: "GUIDE", isTlt: false });
    expect(rosterPrefillFromAnswers(seed.rosterMapping!, { full_name: "Ana Sample", ay_class: "Basic Staff Training" }, spec)).toMatchObject({ classLevel: "BASIC_STAFF_TRAINING", isTlt: false });
  });

  it("never sets the flag for a staff mapping", () => {
    const staff = { ...seed.rosterMapping!, rosterType: "STAFF" as const };
    expect(rosterPrefillFromAnswers(staff, { ay_class: "TLT" }, spec)).toMatchObject({ classLevel: null, isTlt: false });
  });
});

describe("counts and rules use the flag", () => {
  it("meeting attendance groups and counts a flagged youth as a TLT", () => {
    expect(attendanceGroupOf({ attendeeType: "YOUTH", isTlt: true })).toBe("TLT");
    expect(attendanceGroupOf({ attendeeType: "YOUTH", isTlt: false })).toBe("PATHFINDER");
    expect(attendanceGroupOf({ attendeeType: "STAFF", isTlt: true })).toBe("STAFF");
    const counts = countsFromAttendance([
      { attendeeType: "YOUTH", isTlt: true, present: true },
      { attendeeType: "YOUTH", isTlt: false, present: true },
      { attendeeType: "STAFF", isTlt: false, present: true },
    ]);
    expect(counts).toEqual({ pathfinderCount: 2, tltCount: 1, staffCount: 1 });
  });

  it("the year-end report counts flagged youth as TLTs", () => {
    const result = prefillFromRoster([
      { attendeeType: "YOUTH", isTlt: true, gender: "MALE", age: 16 },
      { attendeeType: "YOUTH", isTlt: false, gender: "MALE", age: 16 },
    ]);
    expect(result.tltsOnRoster).toBe(1);
    expect(result.counts.memberMale1112).toBe(2);
  });

  it("team rules treat a flagged TLT of 18 as a team member and anyone else as a coach", () => {
    expect(teamRoleFor({ responses: {}, rosterAttendeeType: "YOUTH", rosterIsTlt: true, maxMemberAge: 19, age: 18 })).toBe("MEMBER");
    expect(teamRoleFor({ responses: {}, rosterAttendeeType: "YOUTH", rosterIsTlt: false, maxMemberAge: 19, age: 18 })).toBe("COACH");
  });

  it("the roster export writes a TLT yes/no for youth and nothing for anyone else", () => {
    expect(rosterTltCell({ attendeeType: "YOUTH", isTlt: true })).toBe("Yes");
    expect(rosterTltCell({ attendeeType: "YOUTH", isTlt: false })).toBe("No");
    expect(rosterTltCell({ attendeeType: "STAFF", isTlt: false })).toBe("");
  });
});

describe("honor minimum class", () => {
  it("a youth flagged TLT meets TLT or lower even with a blank class, and Basic Staff Training ranks above TLT", () => {
    expect(effectiveClassLevel({ attendeeType: "YOUTH", classLevel: null, isTlt: true })).toBe("TLT");
    expect(effectiveClassLevel({ attendeeType: "YOUTH", classLevel: "GUIDE", isTlt: true })).toBe("TLT");
    expect(effectiveClassLevel({ attendeeType: "YOUTH", classLevel: "BASIC_STAFF_TRAINING", isTlt: true })).toBe("BASIC_STAFF_TRAINING");
    expect(effectiveClassLevel({ attendeeType: "YOUTH", classLevel: "GUIDE", isTlt: false })).toBe("GUIDE");
    expect(effectiveClassLevel({ attendeeType: "YOUTH", classLevel: null, isTlt: false })).toBeNull();
    const offering = { honorName: "Sample Honor", prerequisiteHonors: [] };
    const flagged = effectiveClassLevel({ attendeeType: "YOUTH", classLevel: null, isTlt: true });
    expect(requirementGaps({ consumesSeat: true, classLevel: flagged, completedHonorIds: [] }, { ...offering, minimumClassLevel: "TLT" })).toEqual([]);
    expect(requirementGaps({ consumesSeat: true, classLevel: flagged, completedHonorIds: [] }, { ...offering, minimumClassLevel: "BASIC_STAFF_TRAINING" })).toHaveLength(1);
  });
});

describe("form prefill", () => {
  it("starts a flagged TLT as the form's TLT role when it has one, and falls back otherwise", () => {
    const definition = (options: string[]) => ({ sections: [{ id: "s", title: "S", description: "", fields: [{ id: "f", key: "attendee_type", label: "Roster role", type: "RADIO", scope: "ATTENDEE", required: true, options }] }] }) as never;
    const person = { firstName: "Ana", lastName: "Sample", ageOnEventDate: 15, gender: "FEMALE" as const, role: "Pathfinder", attendeeType: "YOUTH" as const };
    expect(rosterRolePrefill(definition(["Pathfinder", "TLT", "Staff", "Child"]), { ...person, isTlt: true })).toEqual({ attendee_type: "TLT" });
    expect(rosterRolePrefill(definition(["Pathfinder", "TLT", "Staff", "Child"]), person)).toEqual({ attendee_type: "Pathfinder" });
    expect(rosterRolePrefill(definition(["Pathfinder", "Staff"]), { ...person, isTlt: true })).toEqual({ attendee_type: "Pathfinder" });
  });
});

describe("migration", () => {
  const sql = read("prisma/migrations/20270115100000_roster_tlt_flag/migration.sql");

  it("adds Basic Staff Training before Master Guide and the flag column", () => {
    expect(sql).toContain(`ALTER TYPE "ClubClassLevel" ADD VALUE IF NOT EXISTS 'BASIC_STAFF_TRAINING' BEFORE 'MASTER_GUIDE'`);
    expect(sql).toContain(`ALTER TABLE "ClubRosterMember" ADD COLUMN "isTlt" BOOLEAN NOT NULL DEFAULT false`);
  });

  it("moves a youth's TLT class to the flag with the class blank, and clears it for anyone else", () => {
    expect(sql).toMatch(/UPDATE "ClubRosterMember" SET "isTlt" = true, "classLevel" = NULL\s+WHERE "classLevel" = 'TLT' AND "attendeeType" = 'YOUTH'/);
    expect(sql).toMatch(/UPDATE "ClubRosterMember" SET "classLevel" = NULL\s+WHERE "classLevel" = 'TLT'/);
    expect(sql.indexOf(`"isTlt" = true`)).toBeLessThan(sql.lastIndexOf(`SET "classLevel" = NULL`));
  });

  it("matches the schema", () => {
    const schema = read("prisma/schema.prisma");
    expect(schema).toMatch(/isTlt\s+Boolean\s+@default\(false\)/);
    expect(schema).toMatch(/TLT\n\s+\/\/\/[^\n]*\n\s+BASIC_STAFF_TRAINING\n\s+MASTER_GUIDE/);
  });
});
