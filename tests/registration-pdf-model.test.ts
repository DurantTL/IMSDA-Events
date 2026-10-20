import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { getFormTemplate, registrationFormDefinitionSchema, type RegistrationFormDefinition } from "@/modules/forms/definition";
import {
  buildRegistrationPdfModel,
  excludedFieldKeys,
  registrationPdfContentHash,
  registrationPdfFilename,
  type RegistrationPdfSource,
} from "@/modules/registration-pdf/model";
import { renderRegistrationPdf } from "@/modules/registration-pdf/render";
import { selfPayDefinition, springCamporeeAttendees, springCamporeeDefinition, springCamporeeSource } from "./support/registration-pdf-fixture";

/** The registration PDF (#1082): what it says, what it never says, and that it draws. Synthetic data only. */

const GENERATED_AT = new Date("2027-03-02T18:00:00.000Z");

function selfPaySource(overrides: Partial<RegistrationPdfSource> = {}): RegistrationPdfSource {
  return {
    eventName: "Synthetic Honors Weekend",
    eventDates: "October 8-10, 2027",
    eventLocation: "Example Academy",
    formTitle: "Synthetic Honors Weekend registration",
    definition: selfPayDefinition(),
    registrationResponses: { email: "pat@example.test", payment_method: "Card", promo_code: "SYNTHETIC10" },
    attendees: [
      { name: "Avery Example", ageOnEventDate: 12, responses: { first_name: "Avery", last_name: "Example", attendee_age: 12, birth_date: "2015-04-01", allergies: "Synthetic peanut", class_choice: "Knots" } },
      { name: "Blake Sample", ageOnEventDate: 15, responses: { first_name: "Blake", last_name: "Sample", attendee_age: 15, birth_date: "2012-01-30", class_choice: "Birds" } },
    ],
    clubName: null,
    teamName: null,
    registrantName: "Pat Example",
    submittedOn: "September 1, 2027",
    fees: { kind: "AMOUNTS", lines: [{ label: "Honors Weekend fee (Avery Example)", amountCents: 4000 }, { label: "Honors Weekend fee (Blake Sample)", amountCents: 4000 }], totalCents: 8000, paidCents: 0, owedCents: 8000 },
    ...overrides,
  };
}

describe("registration PDF content (#1082)", () => {
  it("lays the Spring Camporee club registration out like the form, with the roster as a table", () => {
    const model = buildRegistrationPdfModel(springCamporeeSource());
    expect(model.sections.map((section) => section.title)).toEqual(["Club & contact", "Camping", "Club roster", "Schedule & activities", "Spiritual milestones"]);
    const club = model.sections[0]!;
    expect(club.rows).toContainEqual({ label: "Pathfinder club", value: "Maple Grove Pathfinders" });
    expect(club.rows).toContainEqual({ label: "Club director", value: "Dana Sample" });
    expect(club.roster).toBeNull();

    const roster = model.sections[2]!.roster!;
    expect(roster.columns).toEqual(["Name", "Age", "Gender", "Roster role", "First time at Camporee?", "Medical personnel?", "Master Guide investiture?", "Dietary restrictions"]);
    expect(roster.rows).toHaveLength(12);
    expect(roster.rows[0]).toEqual(["Avery Example", "10", "Female", "Pathfinder", "Yes", "", "", "Synthetic: no peanuts"]);
    expect(roster.countLabel).toBe("12 club members");

    // A question that depends on another answer is shown only when that answer applies.
    const activities = model.sections[3]!.rows.map((row) => row.label);
    expect(activities).toContain("Friday vespers contribution");
    expect(activities).toContain("Flag raising / lowering times");
    expect(activities).not.toContain("Campfire singing night");
    expect(activities).not.toContain("Church / Sabbath School contribution");
    expect(model.sections[3]!.rows.find((row) => row.label === "Required duty area")?.value).toBe("Flag raising / lowering, Bathroom clean-up");
  });

  it("never includes sensitive answers, health-type wording, a birth date, the payment choice or the promo code", () => {
    const camporee = JSON.stringify(buildRegistrationPdfModel(springCamporeeSource()));
    // Owner decision (Caleb, Oct 20, 2026): dietary needs and "Medical personnel?" always print, flag or not.
    expect(camporee).toContain("Synthetic: no peanuts");
    expect(camporee).toContain("Medical personnel?");
    // Every other sensitive answer stays out.
    expect(camporee).not.toContain("medical or accessibility");
    expect(camporee).not.toContain("SYNTHETIC10");

    const selfPay = JSON.stringify(buildRegistrationPdfModel(selfPaySource()));
    expect(selfPay).not.toContain("2015-04-01");
    expect(selfPay).not.toContain("4/1/2015");
    expect(selfPay).not.toContain("Birth");
    expect(selfPay).not.toContain("peanut");
    expect(selfPay).not.toContain("SYNTHETIC10");
    expect(selfPay).not.toContain("How will you pay");
    expect(selfPay).not.toContain("Card");
    // The class (a plain choice) and the age are there, by their form labels.
    expect(selfPay).toContain("Knot Tying");
    expect(selfPay).toContain("Bird Study");
  });

  it("shows age only: the age the registration saved, never a date", () => {
    const model = buildRegistrationPdfModel(selfPaySource());
    const roster = model.sections.find((section) => section.roster)!.roster!;
    expect(roster.columns.slice(0, 2)).toEqual(["Name", "Age"]);
    expect(roster.rows.map((row) => row[1])).toEqual(["12", "15"]);

    // A form with no age question still shows the age the roster saved with the person.
    const noAgeQuestion = registrationFormDefinitionSchema.parse({
      title: "No age question", description: "", confirmationMessage: "Received.",
      attendeeRoster: { enabled: true, minAttendees: 1, maxAttendees: 4, attendeeLabel: "Attendee", addButtonLabel: "Add" },
      sections: [{ id: "people", title: "People", description: "", fields: [
        { id: "fld_first", key: "first_name", label: "First name", helpText: "", type: "TEXT", scope: "ATTENDEE", required: true, options: [] },
        { id: "fld_last", key: "last_name", label: "Last name", helpText: "", type: "TEXT", scope: "ATTENDEE", required: true, options: [] },
        { id: "fld_shirt", key: "t_shirt", label: "T-shirt", helpText: "", type: "SELECT", scope: "ATTENDEE", required: false, options: ["S", "M"] },
      ] }],
    });
    const fromProfile = buildRegistrationPdfModel(selfPaySource({ definition: noAgeQuestion, attendees: [{ name: "Casey Demo", ageOnEventDate: 9, responses: { first_name: "Casey", t_shirt: "M" } }] }));
    expect(fromProfile.sections[0]!.roster!.columns).toEqual(["Name", "T-shirt"]);
  });

  it("honors the explicit sensitive flag and a question linked to a sensitive one", () => {
    const definition = registrationFormDefinitionSchema.parse({
      title: "Flags", description: "", confirmationMessage: "Received.",
      sections: [{ id: "one", title: "One", description: "", fields: [
        { id: "fld_one", key: "favorite_color", label: "Favorite color", helpText: "", type: "TEXT", scope: "REGISTRATION", required: false, options: [], sensitive: true },
        { id: "fld_two", key: "color_why", label: "Why that color", helpText: "", type: "TEXT", scope: "REGISTRATION", required: false, options: [], conditional: { fieldKey: "favorite_color", operator: "NOT_EMPTY", value: "" } },
        { id: "fld_three", key: "nickname", label: "Nickname", helpText: "", type: "TEXT", scope: "REGISTRATION", required: false, options: [] },
        // Staff turned "sensitive" off, so it prints (the PDF follows the flag, like the staff views).
        { id: "fld_four", key: "medication_notes", label: "Medication notes", helpText: "", type: "TEXT", scope: "REGISTRATION", required: false, options: [], sensitive: false },
        // Reads as a health question and has no flag, so the default keeps it out.
        { id: "fld_five", key: "allergies", label: "Allergies", helpText: "", type: "TEXT", scope: "REGISTRATION", required: false, options: [] },
        // Always prints, even when explicitly sensitive (owner decision).
        { id: "fld_six", key: "dietary_needs", label: "Dietary needs", helpText: "", type: "TEXT", scope: "REGISTRATION", required: false, options: [], sensitive: true },
      ] }],
    });
    expect([...excludedFieldKeys(definition)].sort()).toEqual(["allergies", "color_why", "favorite_color"]);
    const model = buildRegistrationPdfModel({
      ...selfPaySource(), definition, attendees: [],
      registrationResponses: { favorite_color: "teal", color_why: "calm", nickname: "Pat", medication_notes: "none", allergies: "x", dietary_needs: "none" },
    });
    // color_why is a plain question, but it is asked only because of a sensitive answer, so (as in the answer filter) it
    // counts as sensitive too.
    const labels = model.sections[0]!.rows.map((row) => row.label);
    expect(labels).toEqual(["Nickname", "Medication notes", "Dietary needs"]);
  });

  it("renders each form version it is on: an older version has its own questions and none of the newer ones", () => {
    const older = selfPayDefinition();
    const newer = registrationFormDefinitionSchema.parse({
      ...older,
      sections: older.sections.map((section) => section.id === "contact"
        ? { ...section, fields: [...section.fields, { id: "f_hotel", key: "hotel_help", label: "Need hotel help?", helpText: "", type: "RADIO", scope: "REGISTRATION", required: false, options: ["Yes", "No"] }] }
        : section),
    });
    const responses = { email: "pat@example.test", hotel_help: "Yes" };
    const onOld = buildRegistrationPdfModel(selfPaySource({ definition: older, registrationResponses: responses }));
    const onNew = buildRegistrationPdfModel(selfPaySource({ definition: newer, registrationResponses: responses }));
    expect(JSON.stringify(onOld)).not.toContain("Need hotel help?");
    expect(JSON.stringify(onNew)).toContain("Need hotel help?");
  });

  it("lists a roster with many questions one person at a time, and a roster with only names as a plain list", () => {
    const wide = registrationFormDefinitionSchema.parse({
      title: "Wide", description: "", confirmationMessage: "Received.",
      attendeeRoster: { enabled: true, minAttendees: 1, maxAttendees: 4, attendeeLabel: "Attendee", addButtonLabel: "Add" },
      sections: [{ id: "people", title: "People", description: "", fields: [
        { id: "fld_zero", key: "first_name", label: "First name", helpText: "", type: "TEXT", scope: "ATTENDEE", required: true, options: [] },
        { id: "fld_zero_last", key: "last_name", label: "Last name", helpText: "", type: "TEXT", scope: "ATTENDEE", required: true, options: [] },
        ...["One", "Two", "Three", "Four", "Five", "Six"].map((label, index) => ({ id: `fld_${index + 1}`, key: `q_${label.toLowerCase()}`, label: `Question ${label}`, helpText: "", type: "TEXT", scope: "ATTENDEE", required: false, options: [] })),
      ] }],
    });
    const attendee = { name: "Casey Demo", ageOnEventDate: null, responses: { first_name: "Casey", q_one: "a", q_two: "b", q_three: "c", q_four: "d", q_five: "e", q_six: "f" } };
    const model = buildRegistrationPdfModel(selfPaySource({ definition: wide, attendees: [attendee], registrationResponses: {} }));
    expect(model.sections[0]!.roster!.columns).toHaveLength(7);
  });

  it("shows a church-billed registration the per-person price only, never a total", () => {
    const model = buildRegistrationPdfModel(springCamporeeSource());
    expect(model.fees).toEqual({ kind: "CHURCH_BILLED", lines: ["$25 per person. Your church is billed after the event.", "Meal sponsorship credit: -$40"] });
    expect(JSON.stringify(model.fees)).not.toMatch(/total/i);
  });
});

describe("registration PDF on the Fall Camporee form (#1082)", () => {
  it("prints the photo and video release, whose section title mentions Sterling, and drops the Sterling question itself", () => {
    const definition = getFormTemplate("fall_camporee")!.definition as RegistrationFormDefinition;
    const model = buildRegistrationPdfModel(springCamporeeSource({
      definition,
      registrationResponses: { photo_video_release: true, background_check_acknowledgment: true, tents: "Two tents" },
      attendees: [],
    }));
    const labels = model.sections.flatMap((section) => section.rows.map((row) => row.label));
    expect(labels).toContain("Photo and video release");
    expect(labels).not.toContain("Adult Sterling Volunteers");
  });
});

describe("registration PDF versions and names (#1082)", () => {
  it("changes its content hash when what it says changes, and not when only a payment posts", () => {
    const base = buildRegistrationPdfModel(selfPaySource());
    const same = buildRegistrationPdfModel(selfPaySource());
    expect(registrationPdfContentHash(same)).toBe(registrationPdfContentHash(base));

    const paid = buildRegistrationPdfModel(selfPaySource({ fees: { kind: "AMOUNTS", lines: [{ label: "Honors Weekend fee (Avery Example)", amountCents: 4000 }, { label: "Honors Weekend fee (Blake Sample)", amountCents: 4000 }], totalCents: 8000, paidCents: 8000, owedCents: 0 } }));
    expect(registrationPdfContentHash(paid)).toBe(registrationPdfContentHash(base));

    const removed = buildRegistrationPdfModel(selfPaySource({ attendees: selfPaySource().attendees.slice(0, 1) }));
    expect(registrationPdfContentHash(removed)).not.toBe(registrationPdfContentHash(base));
    const edited = buildRegistrationPdfModel(selfPaySource({ registrationResponses: { email: "other@example.test" } }));
    expect(registrationPdfContentHash(edited)).not.toBe(registrationPdfContentHash(base));
    // A card choice moves the processing fee without the registration changing: not a new version.
    const withCardFee = buildRegistrationPdfModel(selfPaySource({ fees: { kind: "AMOUNTS", lines: [{ label: "Honors Weekend fee (Avery Example)", amountCents: 4000 }, { label: "Honors Weekend fee (Blake Sample)", amountCents: 4000 }, { label: "Card processing", amountCents: 270 }], totalCents: 8270, paidCents: 0, owedCents: 8270, processingFeeCents: 270 } }));
    expect(registrationPdfContentHash(withCardFee)).toBe(registrationPdfContentHash(base));
    const repriced = buildRegistrationPdfModel(selfPaySource({ fees: { kind: "AMOUNTS", lines: [], totalCents: 4000, paidCents: 0, owedCents: 4000 } }));
    expect(registrationPdfContentHash(repriced)).not.toBe(registrationPdfContentHash(base));
  });

  it("names the file for the event and the club, or the registrant, and marks an updated copy", () => {
    expect(registrationPdfFilename({ eventName: "Spring Camporee 2027", clubName: "Maple Grove Pathfinders", registrantName: "Dana Sample", updated: false })).toBe("Registration-Spring-Camporee-2027-Maple-Grove-Pathfinders.pdf");
    expect(registrationPdfFilename({ eventName: "Synthetic Honors Weekend", clubName: null, registrantName: "Pat O'Example", updated: true })).toBe("Registration-Synthetic-Honors-Weekend-Pat-O-Example-UPDATED.pdf");
    expect(registrationPdfFilename({ eventName: "☃☃", clubName: "../../etc", registrantName: "x", updated: false })).toMatch(/^Registration-Event-etc\.pdf$/);
  });
});

describe("registration PDF drawing (#1082)", () => {
  it("makes a valid, multi-page, repeatable PDF for the Spring Camporee club", async () => {
    const model = buildRegistrationPdfModel(springCamporeeSource({ attendees: springCamporeeAttendees(60) }));
    const first = await renderRegistrationPdf({ model, updated: false, generatedAt: GENERATED_AT, timezone: "America/Chicago" });
    const again = await renderRegistrationPdf({ model, updated: false, generatedAt: GENERATED_AT, timezone: "America/Chicago" });
    expect(Buffer.from(first).subarray(0, 5).toString()).toBe("%PDF-");
    expect(Buffer.from(first).equals(Buffer.from(again))).toBe(true);
    const parsed = await PDFDocument.load(first);
    expect(parsed.getPageCount()).toBeGreaterThan(1);
    expect(first.byteLength).toBeLessThan(10 * 1024 * 1024);
  });

  it("marks an updated copy so it differs from the original", async () => {
    const model = buildRegistrationPdfModel(selfPaySource());
    const original = await renderRegistrationPdf({ model, updated: false, generatedAt: GENERATED_AT, timezone: "America/Chicago" });
    const updated = await renderRegistrationPdf({ model, updated: true, generatedAt: GENERATED_AT, timezone: "America/Chicago" });
    expect(Buffer.from(original).equals(Buffer.from(updated))).toBe(false);
    expect((await PDFDocument.load(updated)).getTitle()).toBe("Updated registration: Synthetic Honors Weekend");
  });

  it("does not fail on text the standard fonts cannot draw, or on a very long unbroken answer", async () => {
    const model = buildRegistrationPdfModel(selfPaySource({ registrationResponses: { email: "x".repeat(5000), payment_method: "Card" }, registrantName: "Zoë ☃ Example" }));
    const bytes = await renderRegistrationPdf({ model, updated: false, generatedAt: GENERATED_AT, timezone: "Not/AZone" });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it("uses the same definition the Spring Camporee template ships", () => {
    expect(springCamporeeDefinition().sections.map((section) => section.id)).toContain("sc_roster");
  });
});
