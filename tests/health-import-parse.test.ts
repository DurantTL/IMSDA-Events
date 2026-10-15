import { describe, expect, it, vi } from "vitest";
import { HealthImportFileError, readHealthImportFiles } from "@/modules/health-records/import-files";
import { HealthImportParseError, importDate, parseCognitoHealthExport, yesNoAnswer } from "@/modules/health-records/import-parser";
import { CARD_HEADERS, CONTACT_HEADERS, MAIN_HEADERS, cardRow, contactRow, csvBytes, mainRow, xlsxBytes, zipBytes } from "./health-import-fixtures";

vi.mock("server-only", () => ({}));

function parse(rows: Array<Record<string, string>>, contacts: Array<Record<string, string>> = [], cards: Array<Record<string, string>> = []) {
  const files = [{ bytes: csvBytes(MAIN_HEADERS, rows) }, { bytes: csvBytes(CONTACT_HEADERS, contacts) }, { bytes: csvBytes(CARD_HEADERS, cards) }];
  return parseCognitoHealthExport(readHealthImportFiles(files));
}

describe("reading the uploaded files", () => {
  it("reads a CSV with quoted commas, quotes and line breaks", () => {
    const rows = [mainRow({ ListAllergiesReactionsSeverityAndNormalRemedyUsed: 'Line one, with comma\nline "two"' })];
    const sheets = readHealthImportFiles([{ bytes: csvBytes(MAIN_HEADERS, rows) }]);
    expect(sheets).toHaveLength(1);
    expect(sheets[0]!.rows[0]!.ListAllergiesReactionsSeverityAndNormalRemedyUsed).toBe('Line one, with comma\nline "two"');
  });

  it("reads every sheet of an Excel workbook, with inline strings", () => {
    const bytes = xlsxBytes([
      { name: "PathfinderHealthRecord", headers: MAIN_HEADERS, rows: [mainRow()] },
      { name: "EmergencyContactsAndAuthorizedP", headers: CONTACT_HEADERS, rows: [contactRow("1001", "e1", "Alex", "Sample", "515-555-0180", "Aunt")] },
    ]);
    const sheets = readHealthImportFiles([{ bytes }]);
    expect(sheets.map((sheet) => sheet.rows.length)).toEqual([1, 1]);
    expect(sheets[0]!.rows[0]!.Name_First).toBe("Riley");
    expect(sheets[1]!.rows[0]!.RelationshipToMinor).toBe("Aunt");
  });

  it("reads shared strings and decodes XML entities", () => {
    const bytes = xlsxBytes([{ name: "PathfinderHealthRecord", headers: MAIN_HEADERS, rows: [mainRow({ Name_Last: "O'Sample & Co <x>" })] }], { sharedStrings: true });
    const [sheet] = readHealthImportFiles([{ bytes }]);
    expect(sheet!.rows[0]!.Name_Last).toBe("O'Sample & Co <x>");
  });

  it("keeps a header-only sheet and refuses files that are not CSV or Excel", () => {
    const [sheet] = readHealthImportFiles([{ bytes: csvBytes(MAIN_HEADERS, []) }]);
    expect(sheet!.rows).toEqual([]);
    expect(() => readHealthImportFiles([{ bytes: new Uint8Array([0xff, 0xfe, 0x00, 0x80]) }])).toThrow(HealthImportFileError);
    expect(() => readHealthImportFiles([{ bytes: zipBytes([{ name: "readme.txt", data: "not a workbook" }]) }])).toThrow(/Excel workbook/);
    expect(() => readHealthImportFiles([])).toThrow(HealthImportFileError);
    expect(() => readHealthImportFiles([{ bytes: new Uint8Array(0) }])).toThrow(/empty/);
  });

  it("refuses a file larger than the limit and a workbook that expands past its limit", () => {
    expect(() => readHealthImportFiles([{ bytes: new Uint8Array(8_000_001).fill(65) }])).toThrow(/8 MB/);
    const bomb = zipBytes([
      { name: "xl/workbook.xml", data: "<workbook/>" },
      { name: "xl/worksheets/sheet1.xml", data: `<worksheet><sheetData>${"<row>".repeat(1)}${" ".repeat(41_000_000)}</sheetData></worksheet>` },
    ]);
    expect(() => readHealthImportFiles([{ bytes: bomb }])).toThrow(HealthImportFileError);
  });

  it("never puts cell content in an error message", () => {
    const bad = csvBytes(["Not_This_Export", "Another"], [{ Not_This_Export: "Synthetic peanut reaction", Another: "x" }]);
    let message = "";
    try {
      parseCognitoHealthExport(readHealthImportFiles([{ bytes: bad }]));
    } catch (error) {
      expect(error).toBeInstanceOf(HealthImportParseError);
      message = (error as Error).message;
    }
    expect(message).toMatch(/Pathfinder Health Record export/);
    expect(message).not.toMatch(/peanut/);
  });
});

describe("mapping the Cognito columns to Health tab fields", () => {
  it("maps every section for a complete entry, joining the club name, contacts and card flag", () => {
    const { entries, unreadableRows } = parse(
      [mainRow({ Address_Line2: "Unit 2", ChurchAndClubName_First: "Example SDA", ChurchAndClubName_Last: "Church Pathfinders" })],
      [
        contactRow("1001", "e1", "Alex", "Sample", "515-555-0180", "Aunt"),
        contactRow("1001", "e2", "Sam", "Sample", "5155550181", "Grandparent"),
        contactRow("2002", "e3", "Other", "Family", "515-555-0182", "Uncle"),
      ],
      [cardRow("1001")],
    );
    expect(unreadableRows).toBe(0);
    const entry = entries[0]!;
    expect(entry.clubText).toBe("Example SDA Church Pathfinders");
    expect(entry.birthDate).toBe("2012-04-09");
    expect(entry.guardianEmail).toBe("parent.sample@example.test");
    expect(entry.values).toMatchObject({
      addressLine1: "9 Imaginary Way",
      addressLine2: "Unit 2",
      city: "Exampleton",
      zip: "00000",
      phone: "(515) 555-0177",
      lastTetanusBooster: "2023-05-01",
      hasAllergies: "YES",
      allergyDetails: "Synthetic peanut reaction, mild, synthetic remedy",
      medications: "Synthetic daily tablet",
      medicalRestrictions: "Synthetic no-running note",
      hasInsurance: "YES",
      insuranceCompany: "Synthetic Cover Co",
      insuranceGroupNumber: "SG-4471 / SP-9",
      insurancePhone: "(515) 555-0178",
      insuranceCardInCognito: true,
      guardianFirstName: "Pat",
      guardianLastName: "Sample",
      guardianPhone: "(515) 555-0179",
      guardianEmail: "Parent.Sample@example.test",
      emergencyContacts: [
        { firstName: "Alex", lastName: "Sample", phone: "(515) 555-0180", relationship: "Aunt" },
        { firstName: "Sam", lastName: "Sample", phone: "(515) 555-0181", relationship: "Grandparent" },
      ],
      signature: { typedName: "Pat Sample", signedOn: "2026-09-20" },
      consent: { emergencyTreatment: true, activities: true, photocopy: true, agreedOn: "2026-09-20", importedFromOnlineForm: true },
    });
    expect(entry.sections).toEqual(["tetanus", "allergies", "medications", "restrictions", "insurance", "guardian", "contacts", "consent"]);
    expect(entry.needsCorrection).toEqual([]);
  });

  it("keeps the insurance card link, file name and storage details out of the record", () => {
    const { entries } = parse([mainRow()], [], [cardRow("1001")]);
    const dump = JSON.stringify(entries[0]);
    expect(dump).not.toMatch(/storage\.example|synthetic-card/);
    expect(entries[0]!.values.insuranceCardInCognito).toBe(true);
  });

  it("keeps a value that fails the shared validators as entered and flags it", () => {
    const { entries } = parse(
      [mainRow({ Phone: "call after school", GuardianEmail: "not-an-email", Address_PostalCode: "5001", InsurancePhoneNumber: "12" })],
      [contactRow("1001", "e1", "Alex", "Sample", "ask Pat", "Aunt")],
    );
    const entry = entries[0]!;
    expect(entry.values.phone).toBe("call after school");
    expect(entry.values.guardianEmail).toBe("not-an-email");
    expect(entry.values.zip).toBe("5001");
    expect(entry.values.insurancePhone).toBe("12");
    expect((entry.values.emergencyContacts as Array<{ phone: string }>)[0]!.phone).toBe("ask Pat");
    expect(entry.needsCorrection.sort()).toEqual(["emergencyContacts.0.phone", "guardianEmail", "insurancePhone", "phone", "zip"]);
    // An invalid parent email is not used to match anyone.
    expect(entry.guardianEmail).toBe("");
  });

  it("treats 'No' allergies, empty answers and 'none' notes as not provided, but never drops a note", () => {
    const { entries } = parse([
      mainRow({ PathfinderHealthRecord_Id: "1", Allergies: "No", ListAllergiesReactionsSeverityAndNormalRemedyUsed: "", ListOfMedicationsOrPertinentHealthincludingMentalHealthInformation: "None", ListOfMedicalRestrictions: "N/A", IsTheParticipantCoveredByMedicalInsurance: "No", InsuranceCompany: "" }),
      mainRow({ PathfinderHealthRecord_Id: "2", Allergies: "No", ListAllergiesReactionsSeverityAndNormalRemedyUsed: "Synthetic bee sting, carries injector" }),
      mainRow({ PathfinderHealthRecord_Id: "3", IsTheParticipantCoveredByMedicalInsurance: "", InsuranceCompany: "Synthetic Cover Co" }),
    ]);
    expect(entries[0]!.values).toMatchObject({ hasAllergies: "NO", hasInsurance: "NO" });
    expect(entries[0]!.values).not.toHaveProperty("medications");
    expect(entries[0]!.values).not.toHaveProperty("medicalRestrictions");
    expect(entries[0]!.values).not.toHaveProperty("insuranceCompany");
    expect(entries[1]!.values).toMatchObject({ hasAllergies: "YES", allergyDetails: "Synthetic bee sting, carries injector" });
    expect(entries[2]!.values.hasInsurance).toBe("YES");
  });

  it("does not claim a consent when there is no signature, and never keeps a signature link", () => {
    const { entries } = parse([
      mainRow({ PathfinderHealthRecord_Id: "1", Signature: "" }),
      mainRow({ PathfinderHealthRecord_Id: "2", Signature: "https://storage.example.test/signature.png" }),
    ]);
    expect(entries[0]!.values).not.toHaveProperty("consent");
    expect(entries[0]!.values).not.toHaveProperty("signature");
    expect(entries[1]!.values.signature).toEqual({ typedName: "", signedOn: "2026-09-20" });
    expect(JSON.stringify(entries[1])).not.toMatch(/signature\.png/);
  });

  it("limits emergency contacts to the Health tab's maximum and says how many were left out", () => {
    const contacts = Array.from({ length: 8 }, (_, index) => contactRow("1001", `e${index}`, `Contact${index}`, "Sample", "515-555-0190", "Friend"));
    const { entries } = parse([mainRow()], contacts);
    expect((entries[0]!.values.emergencyContacts as unknown[]).length).toBe(6);
    expect(entries[0]!.contactsOmitted).toBe(2);
  });

  it("marks Incomplete entries, counts unreadable rows, and uses the later row for a repeated id", () => {
    const { entries, unreadableRows, duplicateIds } = parse([
      mainRow({ PathfinderHealthRecord_Id: "1", Entry_Status: "Incomplete" }),
      mainRow({ PathfinderHealthRecord_Id: "", Name_First: "Nobody" }),
      mainRow({ PathfinderHealthRecord_Id: "3", Name_Last: "" }),
      mainRow({ PathfinderHealthRecord_Id: "4", Phone: "515-555-0101" }),
      mainRow({ PathfinderHealthRecord_Id: "4", Phone: "515-555-0102" }),
    ]);
    expect(entries.map((entry) => entry.sourceId)).toEqual(["1", "4"]);
    expect(entries[0]!.incomplete).toBe(true);
    expect(entries[1]!.values.phone).toBe("(515) 555-0102");
    expect(unreadableRows).toBe(2);
    expect(duplicateIds).toBe(1);
  });

  it("reads Excel date serials and several date layouts", () => {
    expect(importDate("41008")).toBe("2012-04-09");
    expect(importDate("4/9/2012")).toBe("2012-04-09");
    expect(importDate("2012-04-09T00:00:00")).toBe("2012-04-09");
    expect(importDate("2012-02-30")).toBeNull();
    expect(importDate("soon")).toBeNull();
    expect(importDate("")).toBeNull();
    const bytes = xlsxBytes([{ name: "PathfinderHealthRecord", headers: MAIN_HEADERS, rows: [mainRow({ DateOfBirth: "41008" })] }], { numericColumns: ["DateOfBirth"] });
    const { entries } = parseCognitoHealthExport(readHealthImportFiles([{ bytes }]));
    expect(entries[0]!.birthDate).toBe("2012-04-09");
  });

  it("answers yes and no the way Cognito exports them", () => {
    expect(["Yes", "YES", "true", "Checked"].map(yesNoAnswer)).toEqual(["YES", "YES", "YES", "YES"]);
    expect(["No", "false", "None", "N/A"].map(yesNoAnswer)).toEqual(["NO", "NO", "NO", "NO"]);
    expect(yesNoAnswer("maybe")).toBeNull();
    expect(yesNoAnswer(undefined)).toBeNull();
  });

  it("works from the entries sheet alone, and from a workbook with all three sheets in one file", () => {
    expect(parse([mainRow()]).entries).toHaveLength(1);
    const bytes = xlsxBytes([
      { name: "PathfinderHealthRecord", headers: MAIN_HEADERS, rows: [mainRow()] },
      { name: "EmergencyContactsAndAuthorizedP", headers: CONTACT_HEADERS, rows: [contactRow("1001", "e1", "Alex", "Sample", "515-555-0180", "Aunt")] },
      { name: "CopyOfInsuranceCard", headers: CARD_HEADERS, rows: [cardRow("1001")] },
    ]);
    const { entries } = parseCognitoHealthExport(readHealthImportFiles([{ bytes }]));
    expect(entries[0]!.sections).toContain("contacts");
    expect(entries[0]!.values.insuranceCardInCognito).toBe(true);
  });
});
