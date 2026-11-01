import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AttendeeRegistrationAnswersForm } from "@/components/attendee-registration-answers-form";
import {
  editableAttendeeFields,
  isTieredAttendeeFieldEditable,
  prepareTieredAttendeeAnswerUpdate,
} from "@/modules/attendee-accounts/registration-answer-policy";
import { registrationFormDefinitionSchema } from "@/modules/forms/definition";

const field = (key: string, label: string, type: string) => ({
  id: `f_${key}`,
  key,
  label,
  type,
  helpText: "",
  scope: "ATTENDEE",
  required: false,
  options: [],
});

const definition = registrationFormDefinitionSchema.parse({
  title: "Typed answers fixture",
  description: "Fictitious.",
  confirmationMessage: "Done.",
  sections: [{
    id: "details_section",
    title: "Details",
    description: "",
    fields: [
      field("cell_phone", "Cell phone", "PHONE"),
      field("contact_email", "Contact email", "EMAIL"),
      field("arrival_date", "Arrival date", "DATE"),
      field("birth_date", "Birth date", "DATE"),
      field("guardian_phone", "Guardian phone", "PHONE"),
      field("emergency_email", "Emergency contact email", "EMAIL"),
      field("name", "Name", "EMAIL"),
    ],
  }],
});

const base = { definition, policy: "TIERED" as const, registrationResponses: {} };
const run = (currentResponses: Record<string, unknown>, changes: Record<string, unknown>) =>
  prepareTieredAttendeeAnswerUpdate({ ...base, currentResponses, changes });
const failure = (currentResponses: Record<string, unknown>, changes: Record<string, unknown>) => {
  try {
    run(currentResponses, changes);
  } catch (error) {
    return (error as Error).message;
  }
  return "";
};

describe("attendee self-service phone, email and date answers (#1198)", () => {
  it("lists each type as editable unless it is sensitive or protected", () => {
    const keys = editableAttendeeFields(definition, "TIERED").map((item) => item.key);
    expect(keys).toEqual(["cell_phone", "contact_email", "arrival_date"]);
    for (const key of ["birth_date", "guardian_phone", "emergency_email", "name"]) {
      const item = definition.sections[0].fields.find((candidate) => candidate.key === key)!;
      expect(isTieredAttendeeFieldEditable(item)).toBe(false);
      expect(() => run({}, { [key]: "x" })).toThrow(/cannot be changed/);
    }
  });

  it("stores a changed phone in normalised form", () => {
    expect(run({}, { cell_phone: "515.555.0134" }).responses.cell_phone).toBe("(515) 555-0134");
  });

  it("refuses a changed invalid value without echoing it", () => {
    for (const [key, bad] of [["cell_phone", "12-secret"], ["contact_email", "not-an-email-secret"], ["arrival_date", "2026-13-45"]] as const) {
      const message = failure({}, { [key]: bad });
      expect(message).not.toBe("");
      expect(message).not.toContain(bad);
    }
  });

  it("validates a date as a real calendar date", () => {
    expect(failure({}, { arrival_date: "2026-02-30" })).toMatch(/Arrival date/);
    expect(run({}, { arrival_date: "2026-07-04" }).responses.arrival_date).toBe("2026-07-04");
  });

  it("saves an unchanged legacy value, judged against the stored answer", () => {
    const stored = { cell_phone: "call after 5", contact_email: "legacy-at-example", arrival_date: "sometime" };
    const result = run(stored, { ...stored, contact_email: "legacy-at-example" });
    expect(result.responses.cell_phone).toBe("call after 5");
    expect(result.responses.contact_email).toBe("legacy-at-example");
    // A changed value is judged as new, and nothing the browser sends can vouch for it.
    expect(failure(stored, { cell_phone: "call after 6" })).toMatch(/^Cell phone: Enter a 10-digit US number/);
    expect(failure({}, { contact_email: "legacy-at-example" })).toMatch(/^Contact email: Enter a valid email address/);
  });

  it("keeps a differently formatted stored valid phone exactly as stored when left alone", () => {
    const result = run({ cell_phone: "515.555.0134" }, { cell_phone: "(515) 555-0134" });
    expect(result.responses.cell_phone).toBe("515.555.0134");
  });

  it("shows the saved-answer flag, linked to its field, for an old invalid value", () => {
    const fields = editableAttendeeFields(definition, "TIERED");
    const html = renderToStaticMarkup(createElement(AttendeeRegistrationAnswersForm, {
      registrationId: "reg_1",
      initialExpectedUpdatedAt: "2026-10-24T00:00:00.000Z",
      fields,
      initialAttendees: [{ attendeeId: "a1", name: "Test Person", responses: { contact_email: "legacy-at-example" } }],
    }));
    expect(html).toContain("This saved answer needs correcting.");
    expect(html).toContain('id="a1_f_contact_email_error"');
    expect(html).toContain('aria-describedby="a1_f_contact_email_error"');
    expect(html).toContain('type="tel"');
    expect(html).toContain('type="date"');
  });
});

describe("stricter lock for the new types (#1198 review)", () => {
  const specs: Array<[string, string, string]> = [
    ["dob", "DOB", "DATE"],
    ["birthdate", "Birthdate", "DATE"],
    ["bday", "Birthday", "DATE"],
    ["birthday", "Birthday", "DATE"],
    ["physician_phone", "Physician's phone", "PHONE"],
    ["clinic_phone", "Clinic phone", "PHONE"],
    ["insurance_phone", "Insurance company phone", "PHONE"],
    ["parent_email", "Parent email", "EMAIL"],
    ["mother_cell", "Mother's cell", "PHONE"],
    ["last_tetanus", "Date of last tetanus shot", "DATE"],
    ["immunization_date", "Immunization date", "DATE"],
    ["grandmother_cell", "Grandmother's cell", "PHONE"],
    ["grandpa_phone", "Grandpa phone", "PHONE"],
    ["stepdad_email", "Stepdad email", "EMAIL"],
    ["dr_phone", "Dr. phone", "PHONE"],
    ["dentist_phone", "Dentist phone", "PHONE"],
    ["phone", "Phone", "PHONE"],
    ["arrival", "Arrival date", "DATE"],
  ];
  const locked = specs.slice(0, 16).map(([key]) => key);
  const strict = registrationFormDefinitionSchema.parse({
    title: "Strict fixture",
    description: "Fictitious.",
    confirmationMessage: "Done.",
    sections: [{
      id: "strict_section",
      title: "Details",
      description: "",
      fields: [
        ...specs.map(([key, label, type]) => field(key, label, type)),
        { ...field("auto_filled", "Signed on", "DATE"), autoDate: "TODAY" },
        // An older type keeps today's rule, so a plain choice about a parent is not newly locked.
        { ...field("parent_meal", "Meal", "SELECT"), options: ["A", "B"] },
      ],
    }],
  });

  it("locks medical, insurance, parent and birth-date fields and leaves plain ones editable", () => {
    const keys = editableAttendeeFields(strict, "TIERED").map((item) => item.key);
    for (const key of locked) expect(keys).not.toContain(key);
    expect(keys).toEqual(["phone", "arrival", "parent_meal"]);
  });

  it("refuses to change a birth date keyed dob or birthdate", () => {
    for (const key of ["dob", "birthdate"]) {
      expect(() => prepareTieredAttendeeAnswerUpdate({ definition: strict, policy: "TIERED", registrationResponses: {}, currentResponses: {}, changes: { [key]: "2000-01-01" } })).toThrow(/cannot be changed/);
    }
  });

  it("keeps an auto-dated field out of self-service editing", () => {
    expect(editableAttendeeFields(strict, "TIERED").map((item) => item.key)).not.toContain("auto_filled");
  });

  it("shows the server's date floor in the browser too", () => {
    const fields = editableAttendeeFields(strict, "TIERED");
    const html = renderToStaticMarkup(createElement(AttendeeRegistrationAnswersForm, {
      registrationId: "reg_1",
      initialExpectedUpdatedAt: "2026-10-24T00:00:00.000Z",
      fields,
      initialAttendees: [{ attendeeId: "a1", name: "Test Person", responses: { arrival: "1850-01-01" } }],
    }));
    expect(html).toContain("Arrival date can&#x27;t be before 1900.");
  });
});
