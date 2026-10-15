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

  it("finishes quickly on a pathological sheet of tens of thousands of unclosed cells, or refuses it", () => {
    const hostile = `<worksheet><sheetData><row r="1">${"<c r=\"A1\" t=\"inlineStr\"><is><t>".repeat(60_000)}</row><row>${"<c ".repeat(60_000)}`;
    const bytes = zipBytes([{ name: "xl/workbook.xml", data: "<workbook/>" }, { name: "xl/worksheets/sheet1.xml", data: hostile }]);
    const started = Date.now();
    let sheets: unknown[] = [];
    try {
      sheets = readHealthImportFiles([{ bytes }]);
    } catch (error) {
      expect(error).toBeInstanceOf(HealthImportFileError);
    }
    // Refused, or read as a sheet with no usable data; and in linear time either way.
    expect(sheets).toEqual([]);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("refuses a row with more than 300 cells, and a sheet inflating past 15 MB", () => {
    const cells = Array.from({ length: 301 }, (_, index) => `<c r="A${index}" t="inlineStr"><is><t>x</t></is></c>`).join("");
    const wide = zipBytes([{ name: "xl/workbook.xml", data: "<workbook/>" }, { name: "xl/worksheets/sheet1.xml", data: `<sheetData><row>${cells}</row></sheetData>` }]);
    expect(() => readHealthImportFiles([{ bytes: wide }])).toThrow(/too many columns/);
    const big = zipBytes([{ name: "xl/workbook.xml", data: "<workbook/>" }, { name: "xl/worksheets/sheet1.xml", data: " ".repeat(15_000_001) }]);
    expect(() => readHealthImportFiles([{ bytes: big }])).toThrow(/too large/);
  });

  it("refuses a workbook over the entry-count limit, a file too short to be a ZIP, and malformed XML", () => {
    const many = zipBytes(Array.from({ length: 201 }, (_, index) => ({ name: `xl/extra${index}.xml`, data: "<x/>" })));
    expect(() => readHealthImportFiles([{ bytes: many }])).toThrow(/could not be read/);
    expect(() => readHealthImportFiles([{ bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6]) }])).toThrow(HealthImportFileError);
    for (const data of ["<worksheet><sheetData><row><c r=\"A1\"", "not xml at all <<<>>>", "<row><c r=\"A1\" t=\"s\"><v>99</v></c></row>"]) {
      const bytes = zipBytes([{ name: "xl/workbook.xml", data: "<workbook/>" }, { name: "xl/worksheets/sheet1.xml", data }]);
      let outcome: unknown = null;
      try {
        outcome = readHealthImportFiles([{ bytes }]);
      } catch (error) {
        outcome = error;
      }
      // Either a clean refusal or sheets with no data: never a crash of another kind.
      expect(outcome instanceof HealthImportFileError || Array.isArray(outcome)).toBe(true);
    }
  });

  it("refuses a truncated workbook instead of dropping the cells after the cut", () => {
    const cut = `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Name_First</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Riley`;
    const bytes = zipBytes([{ name: "xl/workbook.xml", data: "<workbook/>" }, { name: "xl/worksheets/sheet1.xml", data: cut }]);
    expect(() => readHealthImportFiles([{ bytes }])).toThrow(/cut off or damaged/);
    const noEnd = zipBytes([{ name: "xl/workbook.xml", data: "<workbook/>" }, { name: "xl/worksheets/sheet1.xml", data: `<sheetData><row><c r="A1"><v>1</v>` }]);
    expect(() => readHealthImportFiles([{ bytes: noEnd }])).toThrow(HealthImportFileError);
    const cutTag = zipBytes([{ name: "xl/workbook.xml", data: "<workbook/>" }, { name: "xl/worksheets/sheet1.xml", data: `<sheetData><row><c r="A1" t="inl` }]);
    expect(() => readHealthImportFiles([{ bytes: cutTag }])).toThrow(HealthImportFileError);
  });

  it("leaves phonetic guide runs out of a cell's text", () => {
    const sheet = `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c></row></sheetData></worksheet>`;
    const strings = `<sst><si><t>Name_First</t></si><si><r><t>Riley</t></r><rPh sb="0" eb="1"><t>PHONETIC-GUIDE</t></rPh><phoneticPr fontId="1"/></si></sst>`;
    const bytes = zipBytes([{ name: "xl/workbook.xml", data: "<workbook/>" }, { name: "xl/worksheets/sheet1.xml", data: sheet }, { name: "xl/sharedStrings.xml", data: strings }]);
    const [read] = readHealthImportFiles([{ bytes }]);
    expect(read!.rows[0]!.Name_First).toBe("Riley");
  });

  it("flags a cell over the 20,000-character cap instead of cutting it", () => {
    const huge = "x".repeat(20_001);
    const { entries } = parse([mainRow({ PathfinderHealthRecord_Id: "1", ListOfMedicalRestrictions: huge }), mainRow({ PathfinderHealthRecord_Id: "2" })], [contactRow("2", "e1", "Alex", "Sample", "515-555-0180", huge)]);
    expect(entries.map((entry) => entry.tooLong)).toEqual([true, true]);
    expect(parse([mainRow()]).entries[0]!.tooLong).toBe(false);
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
    });
    expect(entry.values).not.toHaveProperty("consent");
    expect(entry.values).not.toHaveProperty("signature");
    expect(entry.sections).toEqual(["tetanus", "allergies", "medications", "restrictions", "insurance", "guardian", "contacts"]);
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

  it("keeps free text in the allergy answer column, as allergy text", () => {
    const { entries } = parse([
      mainRow({ PathfinderHealthRecord_Id: "1", Allergies: "Penicillin", ListAllergiesReactionsSeverityAndNormalRemedyUsed: "" }),
      mainRow({ PathfinderHealthRecord_Id: "2", Allergies: "Penicillin", ListAllergiesReactionsSeverityAndNormalRemedyUsed: "Synthetic rash, mild" }),
    ]);
    expect(entries[0]!.values).toMatchObject({ hasAllergies: "YES", allergyDetails: "Penicillin" });
    expect(entries[1]!.values).toMatchObject({ hasAllergies: "YES", allergyDetails: "Penicillin\nSynthetic rash, mild" });
    expect(entries[0]!.sections).toContain("allergies");
  });

  it("stores nothing for a blank allergy or insurance answer, never a default No", () => {
    const { entries } = parse([mainRow({
      Allergies: "", ListAllergiesReactionsSeverityAndNormalRemedyUsed: "", IsTheParticipantCoveredByMedicalInsurance: "",
      InsuranceCompany: "", InsuranceGroupAndPolicyNumbers: "", InsurancePhoneNumber: "",
    })]);
    expect(entries[0]!.values).not.toHaveProperty("hasAllergies");
    expect(entries[0]!.values).not.toHaveProperty("hasInsurance");
    expect(entries[0]!.sections).not.toContain("allergies");
    expect(entries[0]!.sections).not.toContain("insurance");
  });

  it("reads Yes with details, No with details (details win), and No with nothing", () => {
    const { entries } = parse([
      mainRow({ PathfinderHealthRecord_Id: "1", Allergies: "Yes", ListAllergiesReactionsSeverityAndNormalRemedyUsed: "Synthetic bee sting" }),
      mainRow({ PathfinderHealthRecord_Id: "2", Allergies: "No", ListAllergiesReactionsSeverityAndNormalRemedyUsed: "Synthetic bee sting, carries injector" }),
      mainRow({ PathfinderHealthRecord_Id: "3", Allergies: "No", ListAllergiesReactionsSeverityAndNormalRemedyUsed: "", IsTheParticipantCoveredByMedicalInsurance: "No", InsuranceCompany: "", InsuranceGroupAndPolicyNumbers: "" }),
      mainRow({ PathfinderHealthRecord_Id: "4", Allergies: "", ListAllergiesReactionsSeverityAndNormalRemedyUsed: "Synthetic dust", IsTheParticipantCoveredByMedicalInsurance: "", InsuranceCompany: "Synthetic Cover Co" }),
      mainRow({ PathfinderHealthRecord_Id: "5", ListOfMedicationsOrPertinentHealthincludingMentalHealthInformation: "None", ListOfMedicalRestrictions: "N/A" }),
    ]);
    expect(entries[0]!.values).toMatchObject({ hasAllergies: "YES", allergyDetails: "Synthetic bee sting" });
    expect(entries[1]!.values).toMatchObject({ hasAllergies: "YES", allergyDetails: "Synthetic bee sting, carries injector" });
    expect(entries[2]!.values).toMatchObject({ hasAllergies: "NO", hasInsurance: "NO" });
    expect(entries[2]!.values).not.toHaveProperty("insuranceCompany");
    expect(entries[3]!.values).toMatchObject({ hasAllergies: "YES", hasInsurance: "YES" });
    expect(entries[4]!.values).not.toHaveProperty("medications");
    expect(entries[4]!.values).not.toHaveProperty("medicalRestrictions");
  });

  it("imports no consent and never reads the signature, whatever the form holds", () => {
    const { entries } = parse([
      mainRow({ PathfinderHealthRecord_Id: "1", Signature: "Pat Sample" }),
      mainRow({ PathfinderHealthRecord_Id: "2", Signature: "https://storage.example.test/signature.png" }),
    ]);
    for (const entry of entries) {
      expect(entry.values).not.toHaveProperty("consent");
      expect(entry.values).not.toHaveProperty("signature");
      expect(entry.sections).not.toContain("consent");
    }
    expect(JSON.stringify(entries)).not.toMatch(/Pat Sample|signature\.png/);
  });

  it("keeps text longer than the Health tab form's limit whole and flags it instead of cutting it", () => {
    const long = "Synthetic note ".repeat(160);
    const { entries } = parse([mainRow({ ListOfMedicationsOrPertinentHealthincludingMentalHealthInformation: long, Address_Line1: "x".repeat(130), InsuranceCompany: "Synthetic Cover Co" })]);
    expect(long.length).toBeGreaterThan(2000);
    expect(entries[0]!.values.medications).toBe(long.trim());
    expect((entries[0]!.values.addressLine1 as string).length).toBe(130);
    expect(entries[0]!.needsCorrection).toEqual(expect.arrayContaining(["medications", "addressLine1"]));
    expect(entries[0]!.needsCorrection).not.toContain("insuranceCompany");
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
    // A four-digit year is not a serial number: it is not a date, so the booster text is kept as typed.
    expect(importDate("2019")).toBeNull();
    expect(importDate("9999")).toBeNull();
    expect(importDate("5000000")).toBeNull();
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

  it("keeps a four-digit year typed as the tetanus booster exactly as typed", () => {
    const { entries } = parse([mainRow({ DateOfLastTetanusBooster: "2019" })]);
    expect(entries[0]!.values.lastTetanusBooster).toBe("2019");
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
