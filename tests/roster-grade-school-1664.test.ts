import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { carriedSchoolValue, carryForwardInputSchema } from "@/modules/club-rosters/carry-forward-domain";
import { parseRosterCsv, planRosterImport, ROSTER_CSV_HEADERS } from "@/modules/club-rosters/csv-import";
import {
  clubSchoolGradeLabels,
  clubSchoolGrades,
  missingRosterFields,
  nextSchoolGrade,
  schoolGradeFromText,
  schoolGradeOrder,
} from "@/modules/club-rosters/domain";
import { ROSTER_EXPORT_COLUMN_KEYS, ROSTER_EXPORT_COLUMNS, rosterExportColumnKeysFor } from "@/modules/club-rosters/export-columns";
import { buildRosterExportTable } from "@/modules/club-rosters/export";
import { rosterMemberInputSchema, rosterMemberUpdateSchema } from "@/modules/club-rosters/schemas";
import { applyRosterFilters, ROSTER_NO_GRADE_FILTER, rosterColumns } from "@/modules/club-rosters/roster-view";
import { clubFormTemplateSeeds } from "@/modules/club-forms/definitions";
import { allFields } from "@/modules/club-forms/domain";
import { rosterMappingProblems, rosterPrefillFromAnswers } from "@/modules/club-forms/roster-mapping";

/** Roster grade (#1664) and school type / church membership (#1668). Synthetic data only. */

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

const base = { role: "Pathfinder", classLevel: "FRIEND", gender: "FEMALE", birthDateNeeded: false };

describe("school grade values", () => {
  it("run from kindergarten to 12th grade, then Not in school", () => {
    expect(clubSchoolGrades).toHaveLength(14);
    expect(clubSchoolGrades[0]).toBe("GRADE_K");
    expect(clubSchoolGrades.at(-1)).toBe("NOT_IN_SCHOOL");
    expect(clubSchoolGradeLabels.GRADE_7).toBe("7th grade");
  });

  it.each([
    ["K", "GRADE_K"], ["Kindergarten", "GRADE_K"], ["5th", "GRADE_5"], ["5", "GRADE_5"], ["12th", "GRADE_12"],
    ["Grade 9", "GRADE_9"], ["9th grade", "GRADE_9"], ["not in school", "NOT_IN_SCHOOL"], ["None", "NOT_IN_SCHOOL"],
  ])("reads %s as %s", (text, grade) => {
    expect(schoolGradeFromText(text)).toBe(grade);
  });

  it.each(["", "13th", "0", "sixth", "seventh-day"])("does not read %j as a grade", (text) => {
    expect(schoolGradeFromText(text)).toBeNull();
  });

  it("sorts K first and Not in school last, and a missing grade has no place", () => {
    expect(schoolGradeOrder("GRADE_K")).toBe(0);
    expect(schoolGradeOrder("GRADE_12")!).toBeLessThan(schoolGradeOrder("NOT_IN_SCHOOL")!);
    expect(schoolGradeOrder(null)).toBeNull();
  });
});

describe("Details needed", () => {
  it("lists a youth with no grade", () => {
    expect(missingRosterFields({ ...base, attendeeType: "YOUTH", schoolGrade: null })).toEqual(["Grade"]);
  });

  it("does not list a youth who has a grade, including Not in school", () => {
    expect(missingRosterFields({ ...base, attendeeType: "YOUTH", schoolGrade: "GRADE_7" })).toEqual([]);
    expect(missingRosterFields({ ...base, attendeeType: "YOUTH", schoolGrade: "NOT_IN_SCHOOL" })).toEqual([]);
  });

  it("never lists staff, adults or underage people for a grade", () => {
    for (const attendeeType of ["STAFF", "ADULT", "UNDERAGE"]) {
      expect(missingRosterFields({ ...base, attendeeType, schoolGrade: null })).toEqual([]);
    }
  });

  it("never asks for school type or church membership", () => {
    const source = read("modules/club-rosters/domain.ts");
    const block = source.slice(source.indexOf("export function missingRosterFields"), source.indexOf("export function rosterRowMissingFields"));
    expect(block).not.toMatch(/member\.(schoolType|churchMember)/);
  });
});

describe("roster columns and the grade filter", () => {
  const options = { birthDatesShown: false, showGender: false, hasScreening: false, hasRowActions: true };

  it("shows Grade next to the class for everyone, and school details only when asked for", () => {
    expect(rosterColumns(options)).toEqual(["name", "age", "type", "class", "grade", "details", "actions"]);
    expect(rosterColumns({ ...options, showSchool: true })).toContain("school");
    expect(rosterColumns(options)).not.toContain("school");
    expect(rosterColumns(options)).not.toContain("churchMember");
  });

  const people = [
    { firstName: "Ana", lastName: "Reyes", attendeeType: "YOUTH", role: "Pathfinder", classLevel: "FRIEND", gender: "FEMALE", birthDateNeeded: false, schoolGrade: "GRADE_7" },
    { firstName: "Ben", lastName: "Lund", attendeeType: "YOUTH", role: "Pathfinder", classLevel: "FRIEND", gender: "MALE", birthDateNeeded: false, schoolGrade: null },
    { firstName: "Cy", lastName: "Okafor", attendeeType: "STAFF", role: "Counselor", classLevel: null, gender: "MALE", birthDateNeeded: false, schoolGrade: null },
  ];

  it("filters to one grade, to nobody with a grade, or to everyone", () => {
    const run = (grade: string) => applyRosterFilters(people, { query: "", detailsOnly: false, keepForCompliance: null, grade }).visible.map((person) => person.firstName);
    expect(run("")).toEqual(["Ana", "Ben", "Cy"]);
    expect(run("GRADE_7")).toEqual(["Ana"]);
    expect(run(ROSTER_NO_GRADE_FILTER)).toEqual(["Ben", "Cy"]);
  });

  it("counts a youth with no grade under Details needed", () => {
    expect(applyRosterFilters(people, { query: "", detailsOnly: true, keepForCompliance: null }).visible.map((person) => person.firstName)).toEqual(["Ben"]);
  });
});

describe("roster input", () => {
  const input = { firstName: "Test", lastName: "Youth", birthDate: "2014-12-06", attendeeType: "YOUTH", gender: "FEMALE" };

  it("accepts the three optional fields, and works without them", () => {
    expect(rosterMemberInputSchema.parse(input).schoolGrade).toBeUndefined();
    const parsed = rosterMemberInputSchema.parse({ ...input, schoolGrade: "GRADE_K", schoolType: "HOMESCHOOL", churchMember: "NO" });
    expect(parsed).toMatchObject({ schoolGrade: "GRADE_K", schoolType: "HOMESCHOOL", churchMember: "NO" });
    expect(rosterMemberUpdateSchema.parse({ schoolGrade: null })).toEqual({ schoolGrade: null });
  });

  it("refuses values that are not on the lists", () => {
    expect(rosterMemberInputSchema.safeParse({ ...input, schoolGrade: "GRADE_13" }).success).toBe(false);
    expect(rosterMemberInputSchema.safeParse({ ...input, schoolType: "PRIVATE" }).success).toBe(false);
    expect(rosterMemberInputSchema.safeParse({ ...input, churchMember: "MAYBE" }).success).toBe(false);
  });
});

describe("roster export", () => {
  it("offers grade as an optional, non-sensitive column", () => {
    expect(ROSTER_EXPORT_COLUMNS.schoolGrade).toEqual({ header: "Grade", sensitive: false });
    expect(rosterExportColumnKeysFor(false)).toContain("schoolGrade");
  });

  it("does not offer school type or church membership, to anyone", () => {
    for (const key of ROSTER_EXPORT_COLUMN_KEYS) expect(key).not.toMatch(/schoolType|churchMember|church|^school$/i);
    expect(rosterExportColumnKeysFor(true).join()).not.toMatch(/schoolType|churchMember/);
  });

  it("writes the grade label in the grade column", () => {
    const member = { id: "m1", firstName: "Ana", lastName: "Reyes", attendeeType: "YOUTH", role: "Pathfinder", classLevel: null, gender: null, status: "ACTIVE", source: "DIRECTOR", age: 12, reportedAge: null, birthDateNeeded: false, updatedAt: "2026-09-01T00:00:00.000Z", schoolGrade: "GRADE_7" } as never;
    const table = buildRosterExportTable([member], [{ key: "schoolGrade", header: "Grade" }]);
    expect(table.rows).toEqual([["7th grade"]]);
  });
});

describe("roster CSV import", () => {
  it("has a Grade column in the template", () => {
    expect(ROSTER_CSV_HEADERS).toContain("Grade");
  });

  it("reads the Grade column, and says so when a grade is not one", () => {
    const rows = parseRosterCsv("First name,Last name,Birth date,Grade\nAna,Reyes,2014-04-17,7th\nBen,Lund,2013-02-03,K\nCy,Okafor,2012-01-01,banana\nDee,Lund,2012-02-02,\n");
    expect(rows[0]!.schoolGrade).toBe("GRADE_7");
    expect(rows[1]!.schoolGrade).toBe("GRADE_K");
    expect(rows[2]!.problems.join(" ")).toMatch(/Grade "banana"/);
    expect(rows[3]!.schoolGrade).toBeUndefined();
  });

  it("notes a missing grade for a new youth and plans an update for a person already on the roster", () => {
    const rows = parseRosterCsv("First name,Last name,Birth date,Type,Grade\nAna,Reyes,2014-04-17,Youth,\nBen,Lund,,Youth,5th\n");
    const plan = planRosterImport(rows, [{ id: "m2", firstName: "Ben", lastName: "Lund" }]);
    expect(plan[0]!.action).toBe("ADD");
    expect(plan[0]!.message).toMatch(/Missing:.*Grade/);
    expect(plan[1]!.action).toBe("UPDATE");
  });
});

describe("year rollover", () => {
  it("moves each grade up one, keeps 12th as 12th, and leaves Not in school and blank alone", () => {
    expect(nextSchoolGrade("GRADE_K")).toBe("GRADE_1");
    expect(nextSchoolGrade("GRADE_7")).toBe("GRADE_8");
    expect(nextSchoolGrade("GRADE_11")).toBe("GRADE_12");
    expect(nextSchoolGrade("GRADE_12")).toBe("GRADE_12");
    expect(nextSchoolGrade("NOT_IN_SCHOOL")).toBe("NOT_IN_SCHOOL");
    expect(nextSchoolGrade(null)).toBeNull();
  });

  it("carries a value only for a youth, and only changes it when the director chose a new one", () => {
    expect(carriedSchoolValue("GRADE_7", { attendeeType: "YOUTH" }, undefined)).toBe("GRADE_7");
    expect(carriedSchoolValue("GRADE_7", { attendeeType: "YOUTH" }, "GRADE_8")).toBe("GRADE_8");
    expect(carriedSchoolValue("GRADE_7", { attendeeType: "YOUTH" }, null)).toBeNull();
    expect(carriedSchoolValue("GRADE_7", { attendeeType: "STAFF" }, "GRADE_8")).toBeNull();
  });

  it("accepts a reviewed grade in the carry-forward request, never an unknown one", () => {
    const person = { memberId: "m1", attendeeType: "YOUTH" as const };
    expect(carryForwardInputSchema.safeParse({ confirm: true, people: [{ ...person, schoolGrade: "GRADE_8" }] }).success).toBe(true);
    expect(carryForwardInputSchema.safeParse({ confirm: true, people: [{ ...person, schoolGrade: "GRADE_20" }] }).success).toBe(false);
  });

  it("is a button in the review, never an automatic move", () => {
    const source = read("components/club-roster-carry-forward.tsx");
    expect(source).toContain("Move everyone up one grade");
    expect(source).toMatch(/onClick=\{moveEveryoneUp\}/);
    // The server only applies grades sent with the confirmation, which the director saw and could change.
    expect(read("modules/club-rosters/carry-forward.ts")).not.toMatch(/nextSchoolGrade/);
  });
});

describe("the Membership Application (#1664, #1668)", () => {
  const seed = clubFormTemplateSeeds.find((candidate) => candidate.key === "pathfinder_membership_application")!;
  const spec = { definition: seed.definition, sensitiveFieldKeys: seed.sensitiveFieldKeys, birthDateFieldKeys: seed.birthDateFieldKeys, hiddenFieldKeys: [] as string[] };

  it("asks the two new questions, both optional", () => {
    const fields = allFields(seed.definition);
    expect(fields.find((field) => field.key === "school_type")).toMatchObject({ label: "School type", type: "SELECT", required: false, options: ["Adventist school", "Public school", "Homeschool", "Other"] });
    expect(fields.find((field) => field.key === "church_member")).toMatchObject({ label: "Is the Pathfinder a member of the Seventh-day Adventist church?", required: false, options: ["Yes", "No", "Not sure"] });
    expect(fields.find((field) => field.key === "grade")!.required).toBe(true);
  });

  it("bumps the version and maps the three fields, passing every mapping check", () => {
    expect(seed.version).toBe(4);
    expect(seed.rosterMapping!.fields).toMatchObject({ schoolGrade: "grade", schoolType: "school_type", churchMember: "church_member" });
    expect(rosterMappingProblems({ ...seed.rosterMapping!, enabled: true }, spec)).toEqual([]);
  });

  it("copies the grade, school type and church membership to the roster prefill", () => {
    const prefill = rosterPrefillFromAnswers(seed.rosterMapping!, { full_name: "Ana Reyes", grade: "7th", school_type: "Homeschool", church_member: "Not sure" }, spec);
    expect(prefill).toMatchObject({ schoolGrade: "GRADE_7", schoolType: "HOMESCHOOL", churchMember: "NOT_SURE" });
  });

  it.each([["5th", "GRADE_5"], ["8th", "GRADE_8"], ["12th", "GRADE_12"]])("maps the form's %s to %s", (answer, grade) => {
    expect(rosterPrefillFromAnswers(seed.rosterMapping!, { grade: answer }, spec).schoolGrade).toBe(grade);
  });

  it("leaves the roster fields empty when the optional questions were not answered", () => {
    const prefill = rosterPrefillFromAnswers(seed.rosterMapping!, { full_name: "Ana Reyes" }, spec);
    expect(prefill).toMatchObject({ schoolGrade: null, schoolType: null, churchMember: null });
  });

  it("copies nothing for a staff mapping, and a staff mapping cannot name them", () => {
    const staff = { ...seed.rosterMapping!, rosterType: "STAFF" as const };
    expect(rosterPrefillFromAnswers(staff, { grade: "7th", school_type: "Public school", church_member: "Yes" }, spec)).toMatchObject({ schoolGrade: null, schoolType: null, churchMember: null });
    expect(rosterMappingProblems(staff, spec).join(" ")).toMatch(/no grade, school or church membership/);
  });
});

describe("who sees school type and church membership (#1668)", () => {
  it("is read only for the club's own roster and a system administrator's Open club page", () => {
    // The club's own roster page and its API routes ask for the values; the roster routes sit behind requireRosterAccess.
    expect(read("app/(public)/account/(portal)/clubs/[organizationId]/roster/page.tsx")).toMatch(/includeSchoolDetails: true/);
    for (const route of ["app/api/attendee/clubs/[organizationId]/roster/route.ts", "app/api/attendee/clubs/[organizationId]/roster/[memberId]/route.ts", "app/api/attendee/clubs/[organizationId]/roster/import/route.ts"]) {
      const source = read(route);
      expect(source, route).toMatch(/requireRosterAccess/);
      expect(source, route).toMatch(/includeSchoolDetails: true/);
    }
    // The system administrator's page passes it only for a system administrator.
    expect(read("app/(workspace)/admin/organizations/[organizationId]/club/page.tsx")).toMatch(/schoolDetails=\{user\.globalRole === "SYSTEM_ADMIN"\}/);
  });

  it("is never asked for by the Area Coordinator, event manager, export or Home views", () => {
    const withoutValues = [
      "app/(public)/account/(portal)/area/[organizationId]/page.tsx",
      "app/(workspace)/more/clubs/[organizationId]/page.tsx",
      "modules/club-rosters/export-repository.ts",
      "app/(public)/account/(portal)/clubs/[organizationId]/page.tsx",
    ];
    for (const file of withoutValues) {
      expect(read(file), file).not.toMatch(/includeSchoolDetails|schoolDetails/);
    }
    // ClubOverview loads without the values unless a caller asks, and only forwards the flag it was given.
    const overview = read("components/club-overview.tsx");
    expect(overview).toMatch(/schoolDetails = false/);
    expect(overview).toMatch(/includeSchoolDetails: schoolDetails/);
  });

  it("is never a roster export column", () => {
    expect(read("modules/club-rosters/export-columns.ts")).not.toMatch(/^\s+(schoolType|churchMember):/m);
    for (const file of ["modules/club-rosters/export-repository.ts", "modules/club-rosters/export.ts"]) {
      expect(read(file)).not.toMatch(/schoolType|churchMember/);
    }
  });
});
