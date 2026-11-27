import { describe, expect, it } from "vitest";
import { registrationFormDefinitionSchema } from "@/modules/forms/definition";
import { draftBase as base, draftDefinition, rosterDraftDefinition as rosterDefinition } from "./support/staff-draft-definition";
import {
  STAFF_DRAFT_LINK_LIFETIME_DAYS,
  sanitizeStaffDraftAttendees,
  sanitizeStaffDraftResponses,
  staffDraftCheckLines,
  staffDraftContact,
  staffDraftLinkExpiry,
  staffDraftPlan,
} from "@/modules/staff-registration-drafts/domain";

describe("staff draft answers keep less (#1510)", () => {
  it("strips excluded, sensitive and unknown keys", () => {
    const kept = sanitizeStaffDraftResponses(draftDefinition, {
      first_name: "Avery",
      last_name: "Example",
      email: "avery@example.test",
      phone: "(515) 555-0100",
      shirt_size: "M",
      birth_date: "2010-01-01",
      allergies: "synthetic",
      notes: "synthetic note",
      waiver: true,
      home: { street: "1 Test Way" },
      made_up: "x",
    });
    expect(kept).toEqual({ first_name: "Avery", last_name: "Example", email: "avery@example.test", phone: "(515) 555-0100", shirt_size: "M" });
  });

  it("drops empty and oversized answers and anything that is not plain", () => {
    const kept = sanitizeStaffDraftResponses(draftDefinition, { first_name: "   ", last_name: "x".repeat(2_000), email: { nested: { deep: 1 } }, shirt_size: "L" });
    expect(kept).toEqual({ shirt_size: "L" });
  });

  it("marks excluded fields as the registrant's to fill in", () => {
    const plan = staffDraftPlan(draftDefinition);
    const editable = Object.fromEntries(plan.sections.flatMap((section) => section.fields.map((entry) => [entry.field.key, entry.editable])));
    expect(editable).toMatchObject({ first_name: true, email: true, shirt_size: true, birth_date: false, allergies: false, notes: false, waiver: false, home: false });
    expect(plan.rosterEnabled).toBe(false);
  });

  it("leaves attendee-roster rows out of the plan", () => {
    const withRoster = registrationFormDefinitionSchema.parse({
      ...draftDefinition,
      attendeeRoster: { enabled: true, minAttendees: 1, maxAttendees: 4, attendeeLabel: "Camper", addButtonLabel: "Add camper" },
      sections: [{
        id: "details", title: "Details", description: "",
        fields: [
          { ...base, id: "reg1", key: "email", label: "Email", type: "EMAIL", required: true },
          { ...base, id: "att1", key: "first_name", label: "Camper first name", type: "TEXT", scope: "ATTENDEE", required: true },
          { ...base, id: "att2", key: "last_name", label: "Camper last name", type: "TEXT", scope: "ATTENDEE", required: true },
        ],
      }],
    });
    const plan = staffDraftPlan(withRoster);
    expect(plan.rosterEnabled).toBe(true);
    expect(plan.sections.flatMap((section) => section.fields.map((entry) => entry.field.key))).toEqual(["email"]);
    expect(sanitizeStaffDraftResponses(withRoster, { email: "a@example.test", first_name: "Camper" })).toEqual({ email: "a@example.test" });
  });
});

describe("people attending on a staff draft (#1510)", () => {
  it("lists the per-person questions, editable only where a browser draft may keep them", () => {
    const plan = staffDraftPlan(rosterDefinition);
    expect(Object.fromEntries(plan.attendeeFields.map((entry) => [entry.field.key, entry.editable]))).toEqual({
      first_name: true, last_name: true, shirt_size: true, birth_date: false, allergies: false, grade: false,
    });
    expect(plan.roster).toEqual({ attendeeLabel: "Camper", addButtonLabel: "Add camper", minAttendees: 1, maxAttendees: 3 });
    expect(staffDraftPlan(draftDefinition).attendeeFields).toEqual([]);
  });

  it("keeps names, shirt size and the like, and never a birth date, medical answer or grade", () => {
    const kept = sanitizeStaffDraftAttendees(rosterDefinition, [
      { clientId: "p1", responses: { first_name: " Sam ", last_name: "Sample", shirt_size: "M", birth_date: "2014-02-01", allergies: "synthetic", grade: "5", made_up: "x" } },
      { clientId: "p2", responses: { first_name: "Riley", last_name: "Sample" } },
    ]);
    expect(kept).toEqual([
      { clientId: "p1", responses: { first_name: "Sam", last_name: "Sample", shirt_size: "M" } },
      { clientId: "p2", responses: { first_name: "Riley", last_name: "Sample" } },
    ]);
  });

  it("drops empty people, repeated or malformed ids, and anyone past the form's limit", () => {
    const kept = sanitizeStaffDraftAttendees(rosterDefinition, [
      { clientId: "p1", responses: { first_name: "A" } },
      { clientId: "p1", responses: { first_name: "Repeat" } },
      { clientId: "has space", responses: { first_name: "B" } },
      { clientId: "p2", responses: { birth_date: "2014-02-01" } },
      { clientId: "p3", responses: { first_name: "C" } },
      { clientId: "p4", responses: { first_name: "D" } },
      { clientId: "p5", responses: { first_name: "E" } },
      "not a person",
    ]);
    expect(kept.map((person) => person.clientId)).toEqual(["p1", "p3", "p4"]);
  });

  it("keeps no people on a form without a roster, or from something that is not a list", () => {
    expect(sanitizeStaffDraftAttendees(draftDefinition, [{ clientId: "p1", responses: { first_name: "A" } }])).toEqual([]);
    expect(sanitizeStaffDraftAttendees(rosterDefinition, { clientId: "p1" })).toEqual([]);
  });

  it("gives staff a missing name or too few people, and leaves a birth date to the registrant", () => {
    const lines = staffDraftCheckLines([
      { kind: "validation", code: "ATTENDEE_COUNT_INVALID", fieldId: null, key: "attendees", path: "attendees", attendeeIndex: null, message: "Add between 1 and 3 campers." },
      { kind: "validation", code: "INVALID_RESPONSE", fieldId: "att2", key: "last_name", path: "attendees.1.responses.last_name", attendeeIndex: 1, message: "This is required." },
      { kind: "validation", code: "INVALID_RESPONSE", fieldId: "att4", key: "birth_date", path: "attendees.0.responses.birth_date", attendeeIndex: 0, message: "This is required." },
    ], rosterDefinition);
    expect(lines.staffNeeds).toEqual(["Add between 1 and 3 campers.", "Camper 2, Camper last name: This is required."]);
    expect(lines.registrantFills).toEqual(["Camper 1, Birth date: This is required."]);
  });
});

describe("staff draft contact and link (#1510)", () => {
  it("reads the registrant's name and email as the public submit does", () => {
    expect(staffDraftContact(draftDefinition, { first_name: "Avery", last_name: "Example", email: "Avery@Example.test" })).toEqual({ name: "Avery Example", email: "avery@example.test" });
    expect(staffDraftContact(draftDefinition, { first_name: "Avery", last_name: "Example" })).toEqual({ name: null, email: null });
    expect(staffDraftContact(draftDefinition, { first_name: "Avery", last_name: "Example", email: "not-an-email" }).email).toBeNull();
  });

  it("expires the link after 14 days", () => {
    const now = new Date("2026-11-13T12:00:00Z");
    expect(STAFF_DRAFT_LINK_LIFETIME_DAYS).toBe(14);
    expect(staffDraftLinkExpiry(now).toISOString()).toBe("2026-11-27T12:00:00.000Z");
  });

  it("splits what staff can still enter from what the registrant fills in, by the form's own labels", () => {
    const lines = staffDraftCheckLines([
      { kind: "validation", code: "INVALID_RESPONSE", fieldId: "fld1", key: "first_name", path: "responses.first_name", attendeeIndex: null, message: "First name is required." },
      { kind: "validation", code: "INVALID_RESPONSE", fieldId: "fld9", key: "waiver", path: "responses.waiver", attendeeIndex: null, message: "This is required." },
      { kind: "validation", code: "INVALID_RESPONSE", fieldId: "fld1", key: "first_name", path: "responses.first_name", attendeeIndex: null, message: "First name is required." },
    ], draftDefinition);
    expect(lines.staffNeeds).toEqual(["First name: First name is required."]);
    expect(lines.registrantFills).toEqual(["I agree to the waiver: This is required."]);
  });
});
