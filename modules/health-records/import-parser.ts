import { normalizePhoneAnswer, validateEmail, validateZip } from "@/lib/field-validation";
import { parseCalendarDate } from "@/modules/club-rosters/domain";
import { MAX_EMERGENCY_CONTACTS, healthFieldsNeedingCorrection, hasHealthNoteFor } from "@/modules/health-records/domain";
import type { SheetRows } from "@/modules/health-records/import-files";

/**
 * Turns the Cognito Forms "Pathfinder Health Record" export (#878) into
 * records shaped like the Health tab's own fields. Pure: no database, no
 * secrets, no I/O, and no logging. The column names are the ones Caleb posted
 * on the issue (headers only, no data).
 *
 * The sheets, joined on `PathfinderHealthRecord_Id`:
 * - `PathfinderHealthRecord`: one row per form entry;
 * - `EmergencyContactsAndAuthorizedP`: several rows per entry;
 * - `CopyOfInsuranceCard`: file metadata only. Nothing in it is read except
 *   that a card exists; the storage link is never kept and never fetched.
 *
 * A value that fails today's phone, email or ZIP check is kept as it was
 * entered and left for the Health tab to flag "needs correcting" (#855). It is
 * never dropped.
 */

/** Stored on an imported consent so it shows as coming from the 2026 online form. */
export const COGNITO_CONSENT_VERSION = "cognito-pathfinder-health-record-2026";

/** The columns the importer cannot work without: who the entry is for and which club it belongs to. */
const REQUIRED_MAIN_COLUMNS = [
  "PathfinderHealthRecord_Id", "Name_First", "Name_Last", "DateOfBirth", "ChurchAndClubName_First", "ChurchAndClubName_Last",
] as const;

const CONTACT_ID = "EmergencyContactsAndAuthorizedP_Id";
const CARD_ID = "CopyOfInsuranceCard_Id";
const ENTRY_ID = "PathfinderHealthRecord_Id";

/** The sections the preview may name. Names only, never a value. */
export const IMPORT_SECTION_LABELS = {
  tetanus: "tetanus booster",
  allergies: "allergies",
  medications: "medications",
  restrictions: "restrictions",
  insurance: "insurance",
  guardian: "guardian",
  contacts: "emergency contacts",
  consent: "consent and signature",
} as const;

export type ImportSection = keyof typeof IMPORT_SECTION_LABELS;

export type ParsedHealthEntry = {
  /** The Cognito entry id. Not health content; it is what the preview and the apply step name a row by. */
  sourceId: string;
  firstName: string;
  lastName: string;
  /** Calendar date (year-month-day), or null when the cell is empty or not a date. */
  birthDate: string | null;
  /** The church and club name as the parent typed it, the two Cognito name parts joined back together. */
  clubText: string;
  /** The parent's email, lower-cased, when it is a valid address. Used only to confirm a match. */
  guardianEmail: string;
  /** When the entry was submitted, for choosing the newest of two entries for one member. "" when unknown. */
  submittedAt: string;
  /** Cognito's own "Incomplete" status: a form that was started and never sent. Never imported. */
  incomplete: boolean;
  /** The values to seal, one per Health tab field key. Never shown, logged or audited. */
  values: Record<string, unknown>;
  sections: ImportSection[];
  /** Field keys that fail today's checks, as stored. Keys only. */
  needsCorrection: string[];
  /** A cell longer than the hard cap (20,000 characters). It is never cut: the row is not imported (NEEDS_CHECK). */
  tooLong: boolean;
  /** Emergency contacts beyond the Health tab's limit that were left out. A count only. */
  contactsOmitted: number;
};

export class HealthImportParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HealthImportParseError";
  }
}

/** Nothing is cut to the Health tab form's limits: a value over one is kept whole and flagged (see FORM_LIMITS). */
const TEXT_CAP = 20_000;

function clean(value: string | undefined, max = TEXT_CAP) {
  return (value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}

/** Free text keeps its line breaks (an allergy list is often several lines). */
function longText(value: string | undefined, max = TEXT_CAP) {
  return (value ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max);
}

const NONE_WORDS = /^(none|n\/?a|na|no|nil|nothing|not applicable|none known|no known allergies|nka|nkda)\.?$/i;

/** Yes / no answers as Cognito exports them ("Yes", "No", "TRUE", a checked box). Null when it is neither. */
export function yesNoAnswer(value: string | undefined): "YES" | "NO" | null {
  const text = clean(value, 40).toLowerCase();
  if (/^(yes|y|true|1|checked|on)$/.test(text)) return "YES";
  if (/^(no|n|false|0|unchecked|off)$/.test(text) || NONE_WORDS.test(text)) return "NO";
  return null;
}

/** A calendar date from an ISO date or date-time, month/day/year, or a 5-digit Excel serial number (10000 to 60000, 1927 to 2063). */
export function importDate(value: string | undefined): string | null {
  const text = clean(value, 60);
  if (!text) return null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(text);
  if (iso) return calendar(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const us = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[T\s].*)?$/.exec(text);
  if (us) return calendar(Number(us[3]), Number(us[1]), Number(us[2]));
  if (/^\d{5}(\.\d+)?$/.test(text)) {
    // Excel stores a date as the days since 1899-12-30.
    const serial = Math.floor(Number(text));
    if (serial >= 10_000 && serial <= 60_000) {
      const date = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
      return calendar(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
    }
  }
  return null;
}

function calendar(year: number, month: number, day: number) {
  const text = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return parseCalendarDate(text) ? text : null;
}

function phoneText(value: string | undefined) {
  const text = clean(value);
  return text ? (normalizePhoneAnswer(text) as string) : "";
}

function emailText(value: string | undefined) {
  const text = clean(value);
  if (!text) return "";
  const check = validateEmail(text);
  return check.ok ? check.value : text;
}

function zipText(value: string | undefined) {
  const text = clean(value);
  if (!text) return "";
  const check = validateZip(text);
  return check.ok ? check.value : text;
}

function join(parts: Array<string | undefined>, separator = " ") {
  return parts.map((part) => clean(part)).filter(Boolean).join(separator);
}

type Sheets = { main: SheetRows; contacts: SheetRows | null; cards: SheetRows | null };

/** Finds the entries sheet and the two optional ones by their header names, whatever the file or sheet is called. */
function classify(sheets: SheetRows[]): Sheets {
  const main = sheets.filter((sheet) => sheet.headers.includes("Name_First") && sheet.headers.includes(ENTRY_ID) && sheet.headers.includes("DateOfBirth"));
  const contacts = sheets.filter((sheet) => sheet.headers.includes(CONTACT_ID));
  const cards = sheets.filter((sheet) => sheet.headers.includes(CARD_ID));
  if (main.length === 0) {
    throw new HealthImportParseError("That doesn't look like the Pathfinder Health Record export. Choose the export of the PathfinderHealthRecord sheet (or the whole workbook).");
  }
  if (main.length > 1 || contacts.length > 1 || cards.length > 1) {
    throw new HealthImportParseError("Each kind of sheet can be chosen only once. Remove the extra files and try again.");
  }
  const missing = REQUIRED_MAIN_COLUMNS.filter((column) => !main[0]!.headers.includes(column));
  if (missing.length > 0) throw new HealthImportParseError(`The entries sheet is missing the column ${missing.join(", ")}.`);
  return { main: main[0]!, contacts: contacts[0] ?? null, cards: cards[0] ?? null };
}

function groupBy(sheet: SheetRows | null) {
  const groups = new Map<string, Array<Record<string, string>>>();
  for (const row of sheet?.rows ?? []) {
    const id = clean(row[ENTRY_ID], 100);
    if (!id) continue;
    groups.set(id, [...(groups.get(id) ?? []), row]);
  }
  return groups;
}

function entryFrom(
  row: Record<string, string>,
  contactRows: Array<Record<string, string>>,
  cardRows: Array<Record<string, string>>,
): ParsedHealthEntry {
  const values: Record<string, unknown> = {};
  const put = (key: string, value: string) => {
    if (value !== "") values[key] = value;
  };
  const sections = new Set<ImportSection>();

  put("addressLine1", clean(row.Address_Line1));
  put("addressLine2", clean(row.Address_Line2));
  put("city", clean(row.Address_City));
  put("state", clean(row.Address_State));
  put("zip", zipText(row.Address_PostalCode));
  put("phone", phoneText(row.Phone));
  put("email", emailText(row.Email));

  const booster = clean(row.DateOfLastTetanusBooster);
  if (booster) {
    // A date is stored as year-month-day; anything else is kept as typed.
    put("lastTetanusBooster", importDate(booster) ?? booster);
    sections.add("tetanus");
  }

  // Allergies. The answer column can hold a yes/no or, on a free-text form, the allergy itself, so a non-yes/no answer is
  // kept as allergy text. Details win over a "No". A blank answer with no details stores nothing: it is never "No".
  const allergyAnswerText = longText(row.Allergies);
  const allergyAnswer = yesNoAnswer(row.Allergies);
  const allergyTextParts = [allergyAnswer === null ? allergyAnswerText : "", longText(row.ListAllergiesReactionsSeverityAndNormalRemedyUsed)]
    .filter((part) => part !== "" && !NONE_WORDS.test(part));
  const allergyText = allergyTextParts.join("\n");
  if (allergyAnswer === "YES" || allergyText !== "") {
    values.hasAllergies = "YES";
    put("allergyDetails", allergyText);
    sections.add("allergies");
  } else if (allergyAnswer === "NO") {
    values.hasAllergies = "NO";
  }

  const medications = longText(row.ListOfMedicationsOrPertinentHealthincludingMentalHealthInformation);
  if (medications !== "" && !NONE_WORDS.test(medications)) {
    put("medications", medications);
    sections.add("medications");
  }
  const restrictions = longText(row.ListOfMedicalRestrictions);
  if (restrictions !== "" && !NONE_WORDS.test(restrictions)) {
    put("medicalRestrictions", restrictions);
    sections.add("restrictions");
  }

  // Insurance: the combined "group and policy numbers" answer cannot be split reliably, so it is kept whole in the
  // group number field and the policy number is left for the director.
  const insuranceCompany = clean(row.InsuranceCompany);
  const insuranceNumbers = clean(row.InsuranceGroupAndPolicyNumbers);
  const insurancePhone = phoneText(row.InsurancePhoneNumber);
  const coveredAnswer = yesNoAnswer(row.IsTheParticipantCoveredByMedicalInsurance);
  // Blank with nothing to go on stores nothing; "No" with no company stores No.
  const hasInsurance = coveredAnswer === "YES" || insuranceCompany !== "" || insuranceNumbers !== "" ? "YES" : coveredAnswer === "NO" ? "NO" : null;
  if (hasInsurance) values.hasInsurance = hasInsurance;
  if (hasInsurance === "YES") {
    put("insuranceCompany", insuranceCompany);
    put("insuranceGroupNumber", insuranceNumbers);
    put("insurancePhone", insurancePhone);
    sections.add("insurance");
  }
  // Only the fact that a card was uploaded: the file itself is in Cognito and is never fetched.
  if (cardRows.length > 0) {
    values.insuranceCardInCognito = true;
    sections.add("insurance");
  }

  put("guardianFirstName", clean(row.GuardianName_First));
  put("guardianLastName", clean(row.GuardianName_Last));
  put("guardianAddress", join([row.GuardianAddress_Line1, row.GuardianAddress_Line2, row.GuardianAddress_City, row.GuardianAddress_State, zipText(row.GuardianAddress_PostalCode)], ", "));
  put("guardianPhone", phoneText(row.GuardianPhone));
  put("guardianEmail", emailText(row.GuardianEmail));
  if (values.guardianFirstName || values.guardianLastName || values.guardianPhone || values.guardianEmail) sections.add("guardian");

  // Emergency contacts for the Health tab (not roster contacts). A contact with no data at all is skipped.
  const contacts = contactRows
    .map((contact) => ({
      firstName: clean(contact.Name_First),
      lastName: clean(contact.Name_Last),
      phone: phoneText(contact.Phone),
      relationship: clean(contact.RelationshipToMinor),
    }))
    .filter((contact) => contact.firstName || contact.lastName || contact.phone || contact.relationship);
  if (contacts.length > 0) {
    values.emergencyContacts = contacts.slice(0, MAX_EMERGENCY_CONTACTS);
    sections.add("contacts");
  }

  // Decided by Caleb Durant, 2026-10-15: a signed 2026 Cognito form counts as the three consents (emergency treatment,
  // activities, photocopy). Only a non-empty `Signature` cell counts as signed; with none, no consent is imported.
  // A typed name is kept as the signature; an image link is never kept or fetched (the typed name stays blank). The
  // date is the form's `Date` column when it parses, otherwise blank.
  const submittedAt = importDate(row.Entry_DateSubmitted) ?? "";
  const signatureCell = clean(row.Signature, 160);
  if (signatureCell) {
    const signedOn = importDate(row.Date) ?? "";
    const isLink = /^(https?:|\/\/|www\.)/i.test(signatureCell);
    values.consent = {
      version: COGNITO_CONSENT_VERSION,
      emergencyTreatment: true,
      activities: true,
      photocopy: true,
      agreedOn: signedOn,
      importedFromOnlineForm: true,
    };
    values.signature = { typedName: isLink ? "" : signatureCell, signedOn };
    sections.add("consent");
  }

  const guardianEmail = clean(row.GuardianEmail, 160).toLowerCase();
  const status = clean(row.Entry_Status, 40).toLowerCase();
  return {
    sourceId: clean(row[ENTRY_ID], 100),
    firstName: clean(row.Name_First, 80),
    lastName: clean(row.Name_Last, 80),
    birthDate: importDate(row.DateOfBirth),
    clubText: join([row.ChurchAndClubName_First, row.ChurchAndClubName_Last]),
    guardianEmail: validateEmail(guardianEmail).ok ? guardianEmail : "",
    submittedAt,
    incomplete: status === "incomplete",
    values,
    sections: (Object.keys(IMPORT_SECTION_LABELS) as ImportSection[]).filter((section) => sections.has(section)),
    needsCorrection: healthFieldsNeedingCorrection(values),
    contactsOmitted: Math.max(0, contacts.length - MAX_EMERGENCY_CONTACTS),
    tooLong: [row, ...contactRows].some((source) => Object.values(source).some((cell) => cell.length > TEXT_CAP)),
  };
}

export type ParsedHealthExport = {
  entries: ParsedHealthEntry[];
  /** Rows with no entry id or no participant name. Counted, never listed. */
  unreadableRows: number;
  /** Entry ids that appeared more than once in the file; the later row is used. */
  duplicateIds: number;
};

/** The export's entries. Throws `HealthImportParseError` (a fixed message, no cell content) when the file is not this export. */
export function parseCognitoHealthExport(sheets: SheetRows[]): ParsedHealthExport {
  const { main, contacts, cards } = classify(sheets);
  const contactGroups = groupBy(contacts);
  const cardGroups = groupBy(cards);
  const byId = new Map<string, ParsedHealthEntry>();
  let unreadableRows = 0;
  let duplicateIds = 0;
  for (const row of main.rows) {
    const id = clean(row[ENTRY_ID], 100);
    if (!id || !clean(row.Name_First, 80) || !clean(row.Name_Last, 80)) {
      unreadableRows += 1;
      continue;
    }
    if (byId.has(id)) duplicateIds += 1;
    byId.set(id, entryFrom(row, contactGroups.get(id) ?? [], cardGroups.get(id) ?? []));
  }
  if (byId.size === 0 && unreadableRows === 0) throw new HealthImportParseError("The entries sheet has no entries.");
  return { entries: [...byId.values()], unreadableRows, duplicateIds };
}

/** True when the parsed entry carries any clinical note, as the Health tab's own flag defines it. */
export function entryHasHealthNote(entry: Pick<ParsedHealthEntry, "values">) {
  return hasHealthNoteFor(entry.values);
}
