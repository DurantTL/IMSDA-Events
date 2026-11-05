import { describe, expect, it } from "vitest";
import {
  areaCoordinatorCsvTemplate,
  AreaCoordinatorCsvError,
  areaCoordinatorPublicStep,
  parseAreaCoordinatorCsv,
  planAreaCoordinatorImport,
} from "@/modules/organizations/area-coordinator-import-domain";

const none = { grantEmails: new Set<string>(), openInviteEmails: new Set<string>() };

describe("Area Coordinator CSV (#1608)", () => {
  it("has the template columns", () => {
    expect(areaCoordinatorCsvTemplate().replace("\uFEFF", "").trim()).toBe('"First name","Last name","Email"');
  });

  it("matches headers ignoring case and extra spaces, and accepts a FluentCRM-style export with other columns", () => {
    const rows = parseAreaCoordinatorCsv("﻿ FIRST   name ,last NAME,Phone,EMAIL\nPat,Example,(515) 555-0100,Pat@Example.test\n");
    expect(rows).toEqual([{ line: 2, firstName: "Pat", lastName: "Example", rawEmail: "Pat@Example.test", email: "pat@example.test", problem: null }]);
  });

  it("rejects a file with no Email column, an empty file, and a file with no people", () => {
    expect(() => parseAreaCoordinatorCsv("First name,Last name\nPat,Example\n")).toThrow(AreaCoordinatorCsvError);
    expect(() => parseAreaCoordinatorCsv("")).toThrow(AreaCoordinatorCsvError);
    expect(() => parseAreaCoordinatorCsv("First name,Last name,Email\n\n,,\n")).toThrow(AreaCoordinatorCsvError);
  });

  it("numbers rows after the header and flags a missing or invalid email", () => {
    const rows = parseAreaCoordinatorCsv("First name,Last name,Email\nA,One,\n\nB,Two,not-an-email\nC,Three,c@example.test\n");
    expect(rows.map((row) => [row.line, row.problem !== null])).toEqual([[2, true], [3, true], [4, false]]);
  });

  it("plans Add, Skip and Error with a reason for each row", () => {
    const rows = parseAreaCoordinatorCsv([
      "First name,Last name,Email",
      "Curtis & Jeanne,Example,couple@example.test",
      "Curtis & Jeanne,Example,couple2@example.test",
      "Pat,Example,active@example.test",
      "Sam,Example,open@example.test",
      "Dup,One,dup@example.test",
      "Dup,Two,DUP@example.test",
      "Bad,Email,nope",
      "Blank,Email,",
    ].join("\n"));
    const plan = planAreaCoordinatorImport(rows, { grantEmails: new Set(["active@example.test"]), openInviteEmails: new Set(["open@example.test"]) });
    expect(plan.map((step) => step.action)).toEqual(["ADD", "ADD", "SKIP", "SKIP", "ADD", "SKIP", "ERROR", "ERROR"]);
    expect(plan[0].inviteName).toBe("Curtis & Jeanne Example");
    expect(plan[2].message).toMatch(/already an area coordinator/i);
    expect(plan[3].message).toMatch(/open area coordinator invite/i);
    expect(plan[5].message).toMatch(/earlier row/i);
    expect(plan.every((step) => step.message.length > 0)).toBe(true);
  });

  it("shows an error row to the dialog as a skip with its reason", () => {
    const [step] = planAreaCoordinatorImport(parseAreaCoordinatorCsv("First name,Last name,Email\nBad,Email,nope\n"), none);
    expect(areaCoordinatorPublicStep(step)).toMatchObject({ action: "SKIP", message: expect.stringMatching(/^Error:/) });
  });
});
