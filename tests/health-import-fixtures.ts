import { deflateRawSync } from "node:zlib";

// Synthetic files for the Cognito health record import (#878). Built from the column headers Caleb posted on the issue,
// with invented names, numbers and notes that identify nobody. No real export is used anywhere.

export const MAIN_HEADERS = [
  "PathfinderHealthRecord_Id", "Name_First", "Name_Last", "Address_Line1", "Address_Line2", "Address_City", "Address_State",
  "Address_PostalCode", "Phone", "Email", "DateOfBirth", "DateOfLastTetanusBooster", "Allergies",
  "ListAllergiesReactionsSeverityAndNormalRemedyUsed", "ListOfMedicationsOrPertinentHealthincludingMentalHealthInformation",
  "ListOfMedicalRestrictions", "IsTheParticipantCoveredByMedicalInsurance", "InsuranceCompany", "InsuranceGroupAndPolicyNumbers",
  "InsurancePhoneNumber", "GuardianName_First", "GuardianName_Last", "GuardianAddress_Line1", "GuardianAddress_Line2",
  "GuardianAddress_City", "GuardianAddress_State", "GuardianAddress_PostalCode", "GuardianPhone", "GuardianEmail",
  "ChurchAndClubName_First", "ChurchAndClubName_Last", "DirectorName_First", "DirectorName_Last", "DirectorEmail",
  "DirectorPhone", "Signature", "Date", "Entry_Status", "Entry_DateCreated", "Entry_DateSubmitted", "Entry_DateUpdated",
] as const;

export const CONTACT_HEADERS = ["PathfinderHealthRecord_Id", "EmergencyContactsAndAuthorizedP_Id", "Name_First", "Name_Last", "Phone", "RelationshipToMinor"] as const;

export const CARD_HEADERS = [
  "PathfinderHealthRecord_Id", "CopyOfInsuranceCard_Id", "CloudSyncRef", "ContentType", "ExternalFolderId", "Field_Name", "File_Name",
  "Height", "Id", "IsEncrypted", "Name", "Size", "StorageUrl", "Width",
] as const;

/** Strings that must never appear in an audit row, log line, preview or error message. */
export const importMarkers = [
  "Synthetic peanut reaction",
  "Synthetic daily tablet",
  "Synthetic no-running note",
  "Synthetic Cover Co",
  "SG-4471",
  "9 Imaginary Way",
  "555-0177",
  "child.import@example.test",
  "https://storage.example.test/synthetic-card.png",
];

export function mainRow(overrides: Partial<Record<(typeof MAIN_HEADERS)[number], string>> = {}) {
  const base: Record<string, string> = {
    PathfinderHealthRecord_Id: "1001",
    Name_First: "Riley",
    Name_Last: "Sample",
    Address_Line1: "9 Imaginary Way",
    Address_City: "Exampleton",
    Address_State: "ZZ",
    Address_PostalCode: "00000",
    Phone: "(515) 555-0177",
    Email: "child.import@example.test",
    DateOfBirth: "2012-04-09",
    DateOfLastTetanusBooster: "2023-05-01",
    Allergies: "Yes",
    ListAllergiesReactionsSeverityAndNormalRemedyUsed: "Synthetic peanut reaction, mild, synthetic remedy",
    ListOfMedicationsOrPertinentHealthincludingMentalHealthInformation: "Synthetic daily tablet",
    ListOfMedicalRestrictions: "Synthetic no-running note",
    IsTheParticipantCoveredByMedicalInsurance: "Yes",
    InsuranceCompany: "Synthetic Cover Co",
    InsuranceGroupAndPolicyNumbers: "SG-4471 / SP-9",
    InsurancePhoneNumber: "515-555-0178",
    GuardianName_First: "Pat",
    GuardianName_Last: "Sample",
    GuardianPhone: "515-555-0179",
    GuardianEmail: "Parent.Sample@example.test",
    ChurchAndClubName_First: "Example",
    ChurchAndClubName_Last: "Pathfinders",
    Signature: "Pat Sample",
    Date: "2026-09-20",
    Entry_Status: "Submitted",
    Entry_DateSubmitted: "2026-09-20T10:00:00",
  };
  return { ...base, ...overrides } as Record<string, string>;
}

export function contactRow(entryId: string, id: string, first: string, last: string, phone: string, relationship: string) {
  return {
    PathfinderHealthRecord_Id: entryId,
    EmergencyContactsAndAuthorizedP_Id: id,
    Name_First: first,
    Name_Last: last,
    Phone: phone,
    RelationshipToMinor: relationship,
  };
}

export function cardRow(entryId: string) {
  return {
    PathfinderHealthRecord_Id: entryId,
    CopyOfInsuranceCard_Id: "c1",
    StorageUrl: "https://storage.example.test/synthetic-card.png",
    File_Name: "synthetic-card.png",
  };
}

function csvCell(value: string) {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function csvBytes(headers: readonly string[], rows: Array<Record<string, string>>) {
  const lines = [headers.map(csvCell).join(","), ...rows.map((row) => headers.map((header) => csvCell(row[header] ?? "")).join(","))];
  return new TextEncoder().encode(lines.join("\r\n"));
}

const escapeXml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

function columnLetter(index: number) {
  let letters = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  return letters;
}

export type SyntheticSheet = { name: string; headers: readonly string[]; rows: Array<Record<string, string>> };

/** A minimal .xlsx: inline strings by default, or shared strings, with an optional numeric (date serial) cell. */
export function xlsxBytes(sheets: SyntheticSheet[], options: { sharedStrings?: boolean; numericColumns?: string[] } = {}) {
  const shared: string[] = [];
  const sheetXml = sheets.map((sheet) => {
    const rows = [sheet.headers.map((header) => header as string), ...sheet.rows.map((row) => sheet.headers.map((header) => row[header] ?? ""))];
    const body = rows.map((cells, rowIndex) => {
      const xml = cells.map((value, columnIndex) => {
        const ref = `${columnLetter(columnIndex)}${rowIndex + 1}`;
        if (value === "") return rowIndex % 2 === 0 ? `<c r="${ref}"/>` : "";
        const header = sheet.headers[columnIndex] as string;
        if (rowIndex > 0 && options.numericColumns?.includes(header) && /^\d+$/.test(value)) return `<c r="${ref}"><v>${value}</v></c>`;
        if (options.sharedStrings) {
          let index = shared.indexOf(value);
          if (index < 0) index = shared.push(value) - 1;
          return `<c r="${ref}" t="s"><v>${index}</v></c>`;
        }
        return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
      }).join("");
      return `<row r="${rowIndex + 1}">${xml}</row>`;
    }).join("");
    return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
  });
  const files: Array<{ name: string; data: string }> = [
    { name: "[Content_Types].xml", data: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>' },
    { name: "xl/workbook.xml", data: `<?xml version="1.0"?><workbook><sheets>${sheets.map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}"/>`).join("")}</sheets></workbook>` },
    ...sheetXml.map((data, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, data })),
  ];
  if (options.sharedStrings) {
    files.push({ name: "xl/sharedStrings.xml", data: `<?xml version="1.0"?><sst>${shared.map((value) => `<si><t xml:space="preserve">${escapeXml(value)}</t></si>`).join("")}</sst>` });
  }
  return zipBytes(files);
}

/** A ZIP with deflated entries. The CRC is left zero: the importer's reader does not check it. */
export function zipBytes(files: Array<{ name: string; data: string }>) {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name);
    const raw = Buffer.from(file.data, "utf8");
    const packed = deflateRawSync(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, packed);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += local.length + name.length + packed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, directory, end]));
}
