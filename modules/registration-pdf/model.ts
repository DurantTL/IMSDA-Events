/**
 * What the registration PDF says (#1082), as plain data. Pure: no database, no clock, no fonts. The repository loads a
 * registration and hands it here; `render.ts` draws the result. The same input is always the same model, so
 * `registrationPdfContentHash` can tell whether a save changed anything a reader would see.
 *
 * The PDF is the whole registration laid out like the form: its sections in order, the registration-level answers as
 * label and value rows, and each section's attendee questions as a roster table (one row per person), then the fees.
 *
 * What never gets in, whatever the form says:
 * - a field marked sensitive, or one that reads as health, medical, insurance, dietary or custody wording
 *   (`resolveFieldOffer`, the same decision the answer filter and the staff views use, including a question linked to a
 *   sensitive one), so health answers stay in their protected views;
 * - a birth date, in any field: only an AGE appears, as of the event (the age the registration saved, never computed
 *   here from a date);
 * - the payment-method answer and the promo code, the confirmation code, and anything that is a private link.
 */

import { createHash } from "node:crypto";
import {
  fieldDisplayLabel,
  getAttendeeRosterConfig,
  isAgeFieldKey,
  isFieldVisible,
  type RegistrationFormDefinition,
  type RegistrationFormField,
} from "@/modules/forms/definition";
import { formatAddressDisplay } from "@/modules/forms/address";
import { resolveFieldOffer } from "@/modules/forms/field-flags";
import { pluralizeAttendeeLabel } from "@/modules/forms/attendee-label";
import { formatTypedDate } from "@/modules/forms/typed-date";
import { perPersonPriceText, type PerPersonPrice } from "@/modules/club-registrations/per-person-price";

/** Bump when the layout or the rules for what is shown change, so an old document is recognizably old. */
export const REGISTRATION_PDF_GENERATOR_VERSION = 1;

/** The largest PDF that is attached to an email (the same cap as the invoice PDF). */
export const REGISTRATION_PDF_MAX_BYTES = 10 * 1024 * 1024;

export type RegistrationPdfAttendee = {
  /** The person's name as the registration holds it. */
  name: string;
  /** Age on the event's age date, as the registration saved it. Never a birth date. */
  ageOnEventDate: number | null;
  responses: Record<string, unknown>;
};

export type RegistrationPdfFees =
  | { kind: "CHURCH_BILLED"; lines: string[] }
  | {
    kind: "AMOUNTS";
    lines: Array<{ label: string; amountCents: number }>;
    totalCents: number;
    /** Succeeded payments less refunds when this copy was made. Not part of the content hash. */
    paidCents: number;
    owedCents: number;
  };

export type RegistrationPdfSource = {
  eventName: string;
  /** Already formatted in the event's own time zone, e.g. "April 17-19, 2027". */
  eventDates: string;
  eventLocation: string;
  formTitle: string;
  definition: RegistrationFormDefinition;
  registrationResponses: Record<string, unknown>;
  attendees: readonly RegistrationPdfAttendee[];
  /** The club (or church) the registration belongs to, when it has one. */
  clubName: string | null;
  teamName: string | null;
  registrantName: string;
  /** Already formatted in the event's time zone, or null when the registration has no submitted time. */
  submittedOn: string | null;
  fees: RegistrationPdfFees | null;
};

export type RegistrationPdfRoster = {
  title: string;
  /** The first column is always the person's name; "Age" follows when anyone has one. */
  columns: string[];
  rows: string[][];
  /** "12 club members", for the line under the table. */
  countLabel: string;
};

export type RegistrationPdfSection = {
  title: string;
  description: string;
  rows: Array<{ label: string; value: string }>;
  roster: RegistrationPdfRoster | null;
};

export type RegistrationPdfModel = {
  eventName: string;
  eventDates: string;
  eventLocation: string;
  formTitle: string;
  clubName: string | null;
  teamName: string | null;
  registrantName: string;
  submittedOn: string | null;
  sections: RegistrationPdfSection[];
  fees: RegistrationPdfFees | null;
};

const NAME_KEYS = new Set(["first_name", "last_name", "full_name", "name", "attendee_name", "guest_name"]);
const BIRTH_DATE_PATTERN = /birth|\bdob\b|bday|\bd\W?o\W?b\b/i;

function isBirthDateField(field: RegistrationFormField) {
  return BIRTH_DATE_PATTERN.test(field.key.replaceAll("_", " ")) || BIRTH_DATE_PATTERN.test(field.label);
}

/** The keys of every field the PDF must never show, from the whole form. */
export function excludedFieldKeys(definition: RegistrationFormDefinition): Set<string> {
  const allFields = definition.sections.flatMap((section) => section.fields);
  const sectionTitleByField = new Map<RegistrationFormField, string>();
  for (const section of definition.sections) for (const field of section.fields) sectionTitleByField.set(field, section.title);
  const paymentKey = definition.payment?.paymentMethodFieldKey ?? null;
  const excluded = new Set<string>();
  for (const field of allFields) {
    const offer = resolveFieldOffer(field, {
      allFields,
      sectionTitleOf: (candidate) => sectionTitleByField.get(candidate) ?? "",
      paymentMethodFieldKey: paymentKey,
    });
    if (
      offer.sensitive
      || isBirthDateField(field)
      || (paymentKey && field.key === paymentKey)
      || field.key === "promo_code"
    ) excluded.add(field.key);
  }
  return excluded;
}

function isBlank(value: unknown) {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as object).length === 0;
  return false;
}

function choiceLabel(field: RegistrationFormField, value: unknown) {
  const text = String(value);
  return field.optionLabels?.[text] ?? text;
}

/** One answer as a reader sees it, or an empty string when there is nothing to show. */
export function displayAnswer(field: RegistrationFormField, value: unknown): string {
  if (isBlank(value)) return "";
  switch (field.type) {
    case "CHECKBOX":
      return value === true || value === "true" || value === "on" || value === "Yes" ? "Yes" : "";
    case "ACKNOWLEDGMENT":
      return value === true || value === "true" ? "Acknowledged" : "";
    case "MULTISELECT":
      return Array.isArray(value) ? value.map((entry) => choiceLabel(field, entry)).join(", ") : choiceLabel(field, value);
    case "RANKED_CHOICE":
      return Array.isArray(value) ? value.map((entry, index) => `${index + 1}. ${choiceLabel(field, entry)}`).join("  ") : choiceLabel(field, value);
    case "SELECT":
    case "RADIO":
      return choiceLabel(field, value);
    case "DATE":
      return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? formatTypedDate(value) : String(value);
    case "ADDRESS":
      return formatAddressDisplay(value);
    default:
      return typeof value === "object" ? "" : String(value).trim();
  }
}

function ageText(attendee: RegistrationPdfAttendee, ageKey: string | null) {
  const fromAnswer = ageKey ? attendee.responses[ageKey] : undefined;
  const parsed = typeof fromAnswer === "number" ? fromAnswer : typeof fromAnswer === "string" && /^\d{1,3}$/.test(fromAnswer.trim()) ? Number(fromAnswer) : null;
  const age = parsed ?? attendee.ageOnEventDate;
  return age === null || !Number.isFinite(age) ? "" : String(age);
}

export function buildRegistrationPdfModel(source: RegistrationPdfSource): RegistrationPdfModel {
  const { definition } = source;
  const excluded = excludedFieldKeys(definition);
  const roster = getAttendeeRosterConfig(definition);
  const rosterTitle = pluralizeAttendeeLabel(roster.attendeeLabel);
  const ageKey = definition.sections.flatMap((section) => section.fields).find((field) => field.scope === "ATTENDEE" && field.type === "NUMBER" && isAgeFieldKey(field.key))?.key ?? null;
  const sections: RegistrationPdfSection[] = [];

  for (const section of definition.sections) {
    const rows: Array<{ label: string; value: string }> = [];
    for (const field of section.fields) {
      if (field.scope !== "REGISTRATION" || excluded.has(field.key)) continue;
      if (!isFieldVisible(field, source.registrationResponses)) continue;
      const value = displayAnswer(field, source.registrationResponses[field.key]);
      if (value) rows.push({ label: fieldDisplayLabel(field), value });
    }

    let rosterTable: RegistrationPdfRoster | null = null;
    const attendeeFields = roster.enabled
      ? section.fields.filter((field) => field.scope === "ATTENDEE" && !excluded.has(field.key) && !NAME_KEYS.has(field.key) && !(ageKey && field.key === ageKey))
      : [];
    const hasNameOrAge = roster.enabled && section.fields.some((field) => field.scope === "ATTENDEE" && (NAME_KEYS.has(field.key) || field.key === ageKey));
    if (roster.enabled && source.attendees.length > 0 && (attendeeFields.length > 0 || hasNameOrAge)) {
      const visibleColumns = attendeeFields.filter((field) => source.attendees.some((attendee) => (
        isFieldVisible(field, { ...source.registrationResponses, ...attendee.responses })
        && displayAnswer(field, attendee.responses[field.key]) !== ""
      )));
      const showAge = hasNameOrAge && ageKey !== null && source.attendees.some((attendee) => ageText(attendee, ageKey) !== "");
      const columns = ["Name", ...(showAge ? ["Age"] : []), ...visibleColumns.map((field) => fieldDisplayLabel(field))];
      if (columns.length > 1 || hasNameOrAge) {
        rosterTable = {
          title: rosterTitle.charAt(0).toUpperCase() + rosterTitle.slice(1),
          columns,
          rows: source.attendees.map((attendee) => [
            attendee.name,
            ...(showAge ? [ageText(attendee, ageKey)] : []),
            ...visibleColumns.map((field) => (
              isFieldVisible(field, { ...source.registrationResponses, ...attendee.responses })
                ? displayAnswer(field, attendee.responses[field.key])
                : ""
            )),
          ]),
          countLabel: `${source.attendees.length} ${source.attendees.length === 1 ? roster.attendeeLabel.toLowerCase() : rosterTitle}`,
        };
      }
    }
    if (rows.length === 0 && !rosterTable) continue;
    sections.push({ title: section.title, description: section.description, rows, roster: rosterTable });
  }

  // A roster form whose people are not asked anything beyond a name still lists who is going.
  if (roster.enabled && source.attendees.length > 0 && !sections.some((section) => section.roster)) {
    sections.push({
      title: rosterTitle.charAt(0).toUpperCase() + rosterTitle.slice(1),
      description: "",
      rows: [],
      roster: {
        title: rosterTitle.charAt(0).toUpperCase() + rosterTitle.slice(1),
        columns: ["Name"],
        rows: source.attendees.map((attendee) => [attendee.name]),
        countLabel: `${source.attendees.length} ${source.attendees.length === 1 ? roster.attendeeLabel.toLowerCase() : rosterTitle}`,
      },
    });
  }

  return {
    eventName: source.eventName,
    eventDates: source.eventDates,
    eventLocation: source.eventLocation,
    formTitle: source.formTitle,
    clubName: source.clubName,
    teamName: source.teamName,
    registrantName: source.registrantName,
    submittedOn: source.submittedOn,
    sections,
    fees: source.fees,
  };
}

/** The fees of a church-billed registration: the per-person price only, never a total (#621). */
export function churchBilledFees(price: PerPersonPrice): RegistrationPdfFees {
  return { kind: "CHURCH_BILLED", lines: perPersonPriceText(price).split("\n").filter(Boolean) };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * A hash of what the PDF says. Payments posted so far are left out (a payment is not a change to the registration, and
 * the paid line is only as of when the copy was made), so paying does not add an "Updated" version.
 */
export function registrationPdfContentHash(model: RegistrationPdfModel): string {
  const comparable = model.fees?.kind === "AMOUNTS"
    ? { ...model, fees: { kind: model.fees.kind, lines: model.fees.lines, totalCents: model.fees.totalCents } }
    : model;
  return createHash("sha256").update(stableJson(comparable)).digest("hex");
}

function fileSafe(text: string, max: number) {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}

/** "Registration-Spring-Camporee-2027-Maple-Grove-Pathfinders.pdf": the event and the club (or the registrant), never a code. */
export function registrationPdfFilename(input: { eventName: string; clubName: string | null; registrantName: string; updated: boolean }) {
  const who = fileSafe(input.clubName || input.registrantName, 40) || "Registrant";
  const event = fileSafe(input.eventName, 40) || "Event";
  return `Registration-${event}-${who}${input.updated ? "-UPDATED" : ""}.pdf`;
}
