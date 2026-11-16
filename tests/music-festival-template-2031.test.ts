import { describe, expect, it } from "vitest";
import { withAttendeeTypeOptions } from "@/modules/attendee-types/form-options";
import { eventTemplatePayloadSchema } from "@/modules/event-templates/domain";
import { starterDescription, starterEventTemplates, starterPayload } from "@/modules/event-templates/starters";
import { unpricedFeeFieldLabels } from "@/modules/events/readiness";
import {
  calculateRosterLineItems,
  calculateRosterTotal,
  formTemplates,
  getFormTemplate,
  isFieldVisible,
  registrationFormDefinitionSchema,
  resolveResponsibleOrganization,
} from "@/modules/forms/definition";
import { preparePublicRegistration } from "@/modules/forms/public-domain";
import { bundledSeededFormTemplates } from "@/modules/forms/seeded-template-data";
import { shirtSizeOptions } from "@/modules/registrations/shirt-sizes";

/** The Iowa-Missouri Music Festival form and starter (#2031). Synthetic data only. */

const key = "music_festival";
const starter = starterEventTemplates.find((entry) => entry.starterKey === key)!;
const definition = getFormTemplate(key)!.definition;
const fields = definition.sections.flatMap((section) => section.fields);
const field = (fieldKey: string) => {
  const found = fields.find((entry) => entry.key === fieldKey);
  if (!found) throw new Error(`no ${fieldKey} field`);
  return found;
};
const hydrated = withAttendeeTypeOptions(definition, starter.attendeeTypes!.map((type) => ({ ...type, id: type.code })) as never);

const registration = { responsible_organization: "Sample Academy", contact_name: "Pat Teacher", email: "school@example.test", phone: "(515) 555-0100" };
const studentAnswers = { voice_part: "1st part Soprano", shirt_size: "Adult M", first_name: "Robin", last_name: "Sample" };
const dorm = { clientId: "a1", responses: { participant_type: "STUDENT_DORM", ...studentAnswers } };
const day = { clientId: "a2", responses: { participant_type: "STUDENT_DAY", ...studentAnswers, first_name: "Lee" } };
const teacher = { clientId: "a3", responses: { participant_type: "TEACHER_SPONSOR", sponsor_title: "Mrs.", first_name: "Ada", last_name: "Sponsor", sponsor_shirt_size: "No T-shirt, please" } };

function submit(attendees: Array<{ clientId: string; responses: Record<string, unknown> }>, responses: Record<string, unknown> = registration) {
  return preparePublicRegistration(hydrated, { responses, attendees, idempotencyKey: "mf2031-idempotency-key" } as never, { timeZone: "America/Chicago", now: new Date("2027-01-15T18:00:00Z") });
}

describe("Iowa-Missouri Music Festival form template (#2031)", () => {
  it("is a seeded, versioned School group template in the built-in list and parses", () => {
    const seed = bundledSeededFormTemplates.find((entry) => entry.key === key)!;
    expect(seed).toMatchObject({ version: 1, name: "Iowa-Missouri Music Festival", audience: "School group" });
    expect(registrationFormDefinitionSchema.safeParse(seed.definition).success).toBe(true);
    expect(formTemplates.some((template) => template.key === key)).toBe(true);
    expect(definition.description).toContain("Sunnydale Academy");
    expect(definition.attendeeRoster).toMatchObject({ enabled: true, attendeeLabel: "Student or teacher" });
  });

  it("asks the school-level questions once, with the sensitive dietary answer kept private", () => {
    for (const name of ["responsible_organization", "contact_name", "email", "phone", "choral_music_copies", "band_music_copies", "lodging_request", "sack_suppers_saturday", "dietary_needs"]) {
      expect(field(name).scope, name).toBe("REGISTRATION");
    }
    expect(field("responsible_organization")).toMatchObject({ type: "TEXT", required: true });
    expect(field("sack_suppers_saturday")).toMatchObject({ type: "NUMBER" });
    expect(field("sack_suppers_saturday").priceCents).toBeUndefined();
    expect(field("dietary_needs")).toMatchObject({ type: "LONG_TEXT", sensitive: true, filterable: false });
  });

  it("keeps the student shirt sizes in step with the shared shirt-size list", () => {
    expect(field("shirt_size").options).toEqual(shirtSizeOptions.filter((size) => size.startsWith("Adult")));
    expect(field("sponsor_shirt_size").options).toEqual([...field("shirt_size").options, "No T-shirt, please"]);
  });

  it("prices $50 / $40 / $0 by attendee type on one per-person fee, and sets no live price", () => {
    expect(field("registration_fee")).toMatchObject({ type: "CALCULATED", scope: "ATTENDEE", attendeeTypePricesCents: { STUDENT_DORM: 5000, STUDENT_DAY: 4000, TEACHER_SPONSOR: 0 } });
    expect(field("registration_fee").priceCents).toBeUndefined();
    const items = calculateRosterLineItems(hydrated, registration, [dorm.responses, day.responses, teacher.responses], "2027-02-01");
    expect(items.map((item) => [item.attendeeIndex, item.amountCents])).toEqual([[0, 5000], [1, 4000]]);
    expect(calculateRosterTotal(hydrated, registration, [dorm.responses, day.responses, teacher.responses], "2027-02-01").totalCents).toBe(9000);
    // A fee with only per-type prices is not flagged as unpriced.
    expect(unpricedFeeFieldLabels(definition)).toEqual([]);
  });

  it("shows student questions to students only and teacher questions to teachers only", () => {
    const studentOnly = ["first_name", "last_name", "voice_part", "shirt_size", "instrument", "teacher_rating", "attendee_age"].filter((name) => field(name).conditional);
    expect(studentOnly).toEqual(["voice_part", "shirt_size", "instrument", "teacher_rating", "attendee_age"]);
    for (const code of ["STUDENT_DORM", "STUDENT_DAY"]) {
      expect(isFieldVisible(field("voice_part"), { participant_type: code })).toBe(true);
      expect(isFieldVisible(field("sponsor_title"), { participant_type: code })).toBe(false);
      expect(isFieldVisible(field("sponsor_shirt_size"), { participant_type: code })).toBe(false);
    }
    expect(isFieldVisible(field("voice_part"), { participant_type: "TEACHER_SPONSOR" })).toBe(false);
    expect(isFieldVisible(field("shirt_size"), { participant_type: "TEACHER_SPONSOR" })).toBe(false);
    expect(isFieldVisible(field("sponsor_title"), { participant_type: "TEACHER_SPONSOR" })).toBe(true);
    expect(isFieldVisible(field("sponsor_shirt_size"), { participant_type: "TEACHER_SPONSOR" })).toBe(true);
    // Every conditional field comes after the selector.
    const order = fields.map((entry) => entry.key);
    for (const entry of fields.filter((candidate) => candidate.conditional)) expect(order.indexOf(entry.key)).toBeGreaterThan(order.indexOf("participant_type"));
  });

  it("accepts a roster of one of each type without the other group's required answers, and names every person", () => {
    const result = submit([dorm, day, teacher]);
    expect(result.isValid, JSON.stringify(result.issues)).toBe(true);
    expect(result.attendees.map((attendee) => [attendee.identity?.firstName, attendee.identity?.lastName])).toEqual([["Robin", "Sample"], ["Lee", "Sample"], ["Ada", "Sponsor"]]);
    expect(resolveResponsibleOrganization(result.responses)).toBe("Sample Academy");
  });

  it("still requires each group's own answers", () => {
    const noVoice = { ...dorm, responses: { ...dorm.responses, voice_part: undefined } };
    expect(submit([noVoice]).isValid).toBe(false);
    const noTitle = { ...teacher, responses: { ...teacher.responses, sponsor_title: undefined } };
    expect(submit([noTitle]).isValid).toBe(false);
    expect(submit([{ ...teacher, responses: { ...teacher.responses, last_name: undefined } }]).isValid).toBe(false);
  });
});

describe("Music Festival starter event template (#2031)", () => {
  it("is general, billed to the school afterwards, and parses with the three attendee types", () => {
    expect(starter).toMatchObject({ name: "Iowa-Missouri Music Festival", formTemplateKey: key, audience: "GENERAL", billingMode: "DEFERRED_ORGANIZATION_INVOICE", collectsShirtSizes: false, checksAdultBackgrounds: false });
    const payload = starterPayload(starter);
    expect(eventTemplatePayloadSchema.safeParse(payload).success).toBe(true);
    expect(payload.attendeeTypes.map((type) => [type.code, type.label, type.sortOrder, type.minimumAge, type.maximumAge])).toEqual([
      ["STUDENT_DORM", "Student, staying on campus", 0, null, null],
      ["STUDENT_DAY", "Student, not staying in the dorm", 1, null, null],
      ["TEACHER_SPONSOR", "Teacher / sponsor", 2, null, null],
    ]);
    expect(payload.registrationClosesOn).toBeUndefined();
    expect(payload.locations ?? []).toEqual([]);
  });

  it("tells staff the dates, the location and the prices to review", () => {
    const text = starterDescription(starter);
    expect(text).toContain("Starter set");
    expect(text).toContain("Thursday, April 8 to Saturday, April 10, 2027");
    expect(text).toContain("Sunnydale Academy");
    expect(text).toContain("$50");
    expect(text).toContain("$40");
    expect(text).toContain("$0");
    expect(text).toContain("billed after the event");
    expect(text).toContain("No registration deadline");
  });
});
