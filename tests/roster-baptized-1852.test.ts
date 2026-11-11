import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseRosterCsv, missingRosterCsvFields, rosterCsvTemplate } from "@/modules/club-rosters/csv-import";
import { BAPTIZED_LABEL, clubBaptizedLabels, missingRosterFields } from "@/modules/club-rosters/domain";
import { buildRosterExportTable } from "@/modules/club-rosters/export";
import { ROSTER_EXPORT_COLUMNS, rosterExportColumnKeysFor } from "@/modules/club-rosters/export-columns";
import { rosterColumns } from "@/modules/club-rosters/roster-view";
import { rosterMemberInputSchema, rosterMemberUpdateSchema } from "@/modules/club-rosters/schemas";
import { clubFormTemplateSeeds } from "@/modules/club-forms/definitions";
import { rosterPrefillFromAnswers, rosterFieldTargets, rosterMappingSchema } from "@/modules/club-forms/roster-mapping";

/** Baptized (#1852): an optional Yes / No / Not sure on every roster member. Synthetic data only. */

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const input = { firstName: "Ana", lastName: "Sample", birthDate: "2010-04-17", attendeeType: "YOUTH" as const, gender: "FEMALE" as const };

describe("labels and schema", () => {
  it("is Yes, No or Not sure, under its own label", () => {
    expect(clubBaptizedLabels).toEqual({ YES: "Yes", NO: "No", NOT_SURE: "Not sure" });
    expect(BAPTIZED_LABEL).toBe("Baptized");
  });

  it("is optional and accepted for every member type", () => {
    expect(rosterMemberInputSchema.parse(input)).not.toHaveProperty("baptized");
    for (const attendeeType of ["YOUTH", "STAFF", "ADULT", "UNDERAGE"] as const) {
      expect(rosterMemberInputSchema.parse({ ...input, attendeeType, baptized: "NOT_SURE" })).toMatchObject({ baptized: "NOT_SURE" });
    }
    expect(rosterMemberInputSchema.parse({ ...input, baptized: null })).toMatchObject({ baptized: null });
    expect(rosterMemberInputSchema.safeParse({ ...input, baptized: "MAYBE" }).success).toBe(false);
    expect(rosterMemberUpdateSchema.parse({ baptized: "YES" })).toEqual({ baptized: "YES" });
    expect(rosterMemberUpdateSchema.safeParse({ baptized: "maybe" }).success).toBe(false);
  });

  it("is never listed under Details needed", () => {
    const member = { attendeeType: "YOUTH" as const, gender: "FEMALE" as const, classLevel: "FRIEND" as const, schoolGrade: "GRADE_5" as const, role: "Pathfinder", baptized: null };
    expect(missingRosterFields(member as never)).toEqual([]);
    expect(read("modules/club-rosters/domain.ts").match(/export function missingRosterFields[\s\S]*?\n}\n/)![0]).not.toMatch(/baptized/);
  });
});

describe("roster CSV", () => {
  const header = "First name,Last name,Birth date,Type,Baptized\n";

  it("reads yes, no and not sure, in any case or spelling", () => {
    const rows = parseRosterCsv(`${header}A,S,2010-04-17,Youth,Yes\nB,S,2010-04-17,Youth,no\nC,S,2010-04-17,Youth,Not sure\nD,S,2010-04-17,Youth,NOT_SURE\nE,S,1980-04-17,Staff,Y\nF,S,2010-04-17,Youth,\n`, 2026);
    expect(rows.map((row) => row.baptized)).toEqual(["YES", "NO", "NOT_SURE", "NOT_SURE", "YES", undefined]);
    expect(rows.every((row) => row.problems.length === 0)).toBe(true);
  });

  it("says so about an answer it cannot read, and never lists a blank as missing", () => {
    const [row] = parseRosterCsv(`${header}A,S,2010-04-17,Youth,Maybe\n`, 2026);
    expect(row!.problems.join(" ")).toMatch(/Baptized "Maybe" should be Yes, No or Not sure/);
    expect(missingRosterCsvFields({ line: 2, firstName: "A", lastName: "S", problems: [] })).not.toContain("Baptized");
  });

  it("is in the template", () => {
    expect(rosterCsvTemplate()).toContain('"Baptized"');
  });
});

describe("exports and views", () => {
  const members = [
    { id: "m1", firstName: "Ana", lastName: "Sample", attendeeType: "YOUTH", baptized: "YES", age: 12, reportedAge: null },
    { id: "m2", firstName: "Sam", lastName: "Sample", attendeeType: "STAFF", baptized: "NOT_SURE", age: 40, reportedAge: null },
    { id: "m3", firstName: "Kim", lastName: "Sample", attendeeType: "ADULT", baptized: null, age: 40, reportedAge: null },
  ];

  it("the director export offers a Baptized column, not sensitive, to everyone who may export", () => {
    expect(ROSTER_EXPORT_COLUMNS.baptized).toEqual({ header: "Baptized", sensitive: false });
    expect(rosterExportColumnKeysFor(false)).toContain("baptized");
    const table = buildRosterExportTable(members as never, [{ key: "baptized", header: "Baptized" }]);
    expect(table).toEqual({ headers: ["Baptized"], rows: [["Yes"], ["Not sure"], [""]] });
  });

  it("the roster table adds a Baptized column for any viewer who asks, after the school columns", () => {
    const base = { birthDatesShown: false, showGender: false, hasScreening: false, hasRowActions: false };
    expect(rosterColumns(base)).not.toContain("baptized");
    expect(rosterColumns({ ...base, showBaptized: true })).toEqual(["name", "age", "type", "class", "grade", "details", "baptized"]);
    expect(rosterColumns({ ...base, showSchool: true, showBaptized: true }).slice(-3)).toEqual(["school", "churchMember", "baptized"]);
  });
});

describe("Area Coordinator visibility", () => {
  it("baptized is listed for every viewer, while school type and church member stay gated", () => {
    const repo = read("modules/club-rosters/repository.ts");
    const serializer = repo.match(/function serializeMember[\s\S]*?\n}\n/)![0];
    expect(serializer).toMatch(/\.\.\.\(includeSchoolDetails \? \{ schoolType: member\.schoolType, churchMember: member\.churchMember \} : \{\}\)/);
    expect(serializer).toMatch(/\n\s+baptized: member\.baptized,/);
  });

  it("the workspace shows the Baptized toggle outside the school-details gate", () => {
    const workspace = read("components/club-roster-workspace.tsx");
    expect(workspace).toMatch(/showBaptized,\n/);
    expect(workspace).not.toMatch(/schoolDetails && showBaptized/);
  });
});

describe("form roster mapping", () => {
  const seed = clubFormTemplateSeeds.find((candidate) => candidate.key === "pathfinder_membership_application")!;
  const spec = { definition: seed.definition, sensitiveFieldKeys: seed.sensitiveFieldKeys, birthDateFieldKeys: seed.birthDateFieldKeys, hiddenFieldKeys: [] as string[] };

  it("offers a baptized target and reads it for youth and staff", () => {
    expect(rosterFieldTargets).toContain("baptized");
    const mapping = { ...seed.rosterMapping!, fields: { ...seed.rosterMapping!.fields, baptized: "church_member" } };
    expect(rosterMappingSchema.safeParse(mapping).success).toBe(true);
    expect(rosterPrefillFromAnswers(mapping, { full_name: "Ana Sample", church_member: "Not sure" }, spec)).toMatchObject({ baptized: "NOT_SURE" });
    const staff = { ...mapping, rosterType: "STAFF" as const, fields: { fullName: "full_name", baptized: "church_member" } };
    expect(rosterPrefillFromAnswers(staff, { full_name: "Sam Sample", church_member: "Yes" }, spec)).toMatchObject({ baptized: "YES" });
    expect(rosterPrefillFromAnswers(mapping, { full_name: "Ana Sample" }, spec)).toMatchObject({ baptized: null });
  });
});

describe("carry-forward and transfers", () => {
  it("carry the answer to the new year and to the new club, whatever the new type", () => {
    const carry = read("modules/club-rosters/carry-forward.ts");
    expect(carry).toMatch(/churchMember: true, baptized: true/);
    expect(carry).toMatch(/baptized: source\.baptized,/);
    const transfers = read("modules/club-transfers/repository.ts");
    expect(transfers).toMatch(/baptized: sending\.baptized,/);
    expect(transfers).toMatch(/churchMember: true,\n\s+baptized: true,/);
  });
});

describe("migration", () => {
  const sql = read("prisma/migrations/20270116100000_roster_baptized/migration.sql");

  it("creates the enum and a nullable column, and moves no data", () => {
    expect(sql).toContain(`CREATE TYPE "ClubRosterBaptized" AS ENUM ('YES', 'NO', 'NOT_SURE')`);
    expect(sql).toContain(`ALTER TABLE "ClubRosterMember" ADD COLUMN "baptized" "ClubRosterBaptized"`);
    expect(sql).not.toMatch(/\b(UPDATE|DELETE|INSERT)\b/);
    expect(sql).not.toMatch(/NOT NULL/);
  });

  it("matches the schema", () => {
    const schema = read("prisma/schema.prisma");
    expect(schema).toMatch(/enum ClubRosterBaptized \{\n\s+YES\n\s+NO\n\s+NOT_SURE\n\}/);
    expect(schema).toMatch(/baptized\s+ClubRosterBaptized\?/);
    expect(read("prisma/migrations/20270115100000_roster_tlt_flag/migration.sql")).toBeTruthy();
  });
});
