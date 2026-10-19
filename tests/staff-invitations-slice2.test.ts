import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { StaffInvitationQuestions } from "@/components/staff-invitation-questions";
import { registrationFormDefinitionSchema, type RegistrationFormDefinition } from "@/modules/forms/definition";
import { buildStaffMealServiceCounts, staffMealServiceCsvRows, type CoveredMealRow } from "@/modules/meals/staff-coverage-domain";
import { buildKitchenReport, kitchenReportCsv } from "@/modules/registrations/kitchen-report";
import { toStaffQuestion } from "@/modules/staff-invitations/event-questions";
import { staffInvitationErrorStatus } from "@/modules/staff-invitations/repository";
import { checkPartyAnswers, staffEventQuestions, staffQuestionExclusion } from "@/modules/staff-invitations/event-questions";
import { FAMILY_MAX_DEPENDANTS, invitationReinvitable, invitationRegistrationSchema } from "@/modules/staff-invitations/domain";

type FieldInput = Record<string, unknown>;

function field(key: string, extra: FieldInput = {}) {
  return { id: `field-${key}`, key, label: key.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase()), helpText: "", type: "TEXT", scope: "ATTENDEE", required: false, options: [], ...extra };
}

function definition(fields: FieldInput[], more: FieldInput[] = []): RegistrationFormDefinition {
  return registrationFormDefinitionSchema.parse({
    title: "Synthetic event form",
    confirmationMessage: "Thanks, synthetic.",
    sections: [{ id: "people", title: "People", fields }, ...(more.length > 0 ? [{ id: "extras", title: "Extras", fields: more }] : [])],
  });
}

const sizes = ["Small", "Medium", "Large"];

const form = definition(
  [
    field("first_name", { required: true }),
    field("last_name", { required: true }),
    field("attendee_age", { type: "NUMBER" }),
    field("attendee_type", { type: "RADIO", options: ["Adult", "Child"], required: true }),
    field("shirt_size", { type: "SELECT", options: sizes, required: true }),
    field("hobby"),
    field("ministry_areas", { type: "MULTISELECT", options: ["Music", "Kitchen", "Grounds"], minSelections: 1, maxSelections: 2, required: true }),
    field("rides_in_van", { type: "CHECKBOX" }),
    field("van_seat_notes", { conditional: { fieldKey: "rides_in_van", operator: "EQUALS", value: "true" } }),
    // Left out: priced, meal, lodging, health-type, registration-level, calculated.
    field("workshop_fee", { type: "SELECT", options: ["Yes", "No"], choicePricesCents: { Yes: 500 } }),
    field("lunch_adult_qty", { type: "NUMBER" }),
    field("meal_choice", { type: "RADIO", options: ["Regular", "Vegetarian"], required: true }),
    field("lodging_choice", { type: "RADIO", options: ["Dorm", "Cabin"], required: true }),
    field("nights_attending", { type: "MULTISELECT", options: ["Tuesday", "Wednesday"] }),
    field("allergies", { type: "LONG_TEXT", required: true }),
    field("registration_fee", { type: "CALCULATED", priceCents: 12500 }),
    field("limited_seminar", { type: "RADIO", options: ["A", "B"], availabilityMode: "CAPACITY", choiceLimits: { A: 5 } }),
    field("hearing_help_note", { conditional: { fieldKey: "lodging_choice", operator: "EQUALS", value: "Dorm" } }),
  ],
  [field("church_name", { scope: "REGISTRATION", required: true }), field("payment_method", { scope: "REGISTRATION", type: "RADIO", options: ["Pay later", "Card"], required: true })],
);

describe("the event's questions on the staff link form (#1027)", () => {
  it("asks the attendee questions, but not priced, meal, lodging, health, registration-level or already-known ones", () => {
    const keys = staffEventQuestions(form).map((entry) => entry.key);
    expect(keys).toEqual(["shirt_size", "hobby", "ministry_areas", "rides_in_van", "van_seat_notes"]);
  });

  it("gives a reason for each question it leaves out", () => {
    const reason = (key: string) => {
      const found = form.sections.flatMap((section) => section.fields).find((entry) => entry.key === key)!;
      return staffQuestionExclusion(found);
    };
    expect(reason("workshop_fee")).toBe("priced");
    expect(reason("registration_fee")).toBe("priced");
    expect(reason("lunch_adult_qty")).toBe("meal");
    expect(reason("meal_choice")).toBe("meal");
    expect(reason("lodging_choice")).toBe("lodging");
    expect(reason("nights_attending")).toBe("lodging");
    expect(reason("limited_seminar")).toBe("capacity-limited");
    expect(reason("allergies")).toBe("sensitive");
    expect(reason("church_name")).toBe("registration-level");
    expect(reason("first_name")).toBe("already-known");
    expect(reason("shirt_size")).toBeNull();
  });

  it("drops a question that only applies when a left-out question is answered a certain way", () => {
    expect(staffEventQuestions(form).map((entry) => entry.key)).not.toContain("hearing_help_note");
  });

  it("asks nothing when the event has no published form", () => {
    expect(staffEventQuestions(null)).toEqual([]);
    expect(checkPartyAnswers(null, [{ shirt_size: "Small" }], 2)).toEqual({ answers: [{}, {}], problems: [] });
  });

  it("enforces required questions for every person in the party, on the server", () => {
    const checked = checkPartyAnswers(form, [{ shirt_size: "Small", ministry_areas: ["Music"] }, { ministry_areas: ["Music"] }], 2);
    expect(checked.problems).toEqual(["Person 2: Shirt size is required."]);
    expect(checkPartyAnswers(form, [], 1).problems).toEqual(["Shirt size is required.", "Ministry areas is required."]);
  });

  it("rejects an answer that is not one of the configured choices, or has the wrong type or count", () => {
    expect(checkPartyAnswers(form, [{ shirt_size: "Huge", ministry_areas: ["Music"] }], 1).problems).toEqual(["Shirt size must use one of its configured choices."]);
    expect(checkPartyAnswers(form, [{ shirt_size: "Small", ministry_areas: ["Music", "Kitchen", "Grounds"] }], 1).problems).toEqual(["Ministry areas allows up to 2 choices."]);
    expect(checkPartyAnswers(form, [{ shirt_size: "Small", ministry_areas: ["Music"], hobby: 42 }], 1).problems).toEqual(["Hobby must be text."]);
  });

  it("keeps only the asked, visible answers, so a crafted request can't write a priced, meal or lodging one", () => {
    const checked = checkPartyAnswers(
      form,
      [{
        shirt_size: "Large",
        ministry_areas: ["Kitchen"],
        hobby: "  Birdwatching  ",
        van_seat_notes: "Window seat",
        // None of these is asked.
        lodging_choice: "Cabin",
        meal_choice: "Vegetarian",
        lunch_adult_qty: 3,
        workshop_fee: "Yes",
        meal_coverage: "Not covered",
        church_name: "Synthetic church",
        allergies: "Synthetic",
      }],
      1,
    );
    expect(checked.problems).toEqual([]);
    // The conditional note is not visible (the box was not ticked), so it is dropped too.
    expect(checked.answers).toEqual([{ shirt_size: "Large", ministry_areas: ["Kitchen"], hobby: "  Birdwatching  " }]);
    const shown = checkPartyAnswers(form, [{ shirt_size: "Large", ministry_areas: ["Kitchen"], rides_in_van: true, van_seat_notes: "Window seat" }], 1);
    expect(shown.answers[0]).toMatchObject({ rides_in_van: true });
  });

  it("accepts at most one set of answers per person the form can hold", () => {
    expect(invitationRegistrationSchema.safeParse({ firstName: "A", lastName: "B", answers: Array.from({ length: 2 + FAMILY_MAX_DEPENDANTS + 1 }, () => ({})) }).success).toBe(false);
    expect(invitationRegistrationSchema.safeParse({ firstName: "A", lastName: "B", answers: [{ shirt_size: "Small" }] }).success).toBe(true);
    expect(invitationRegistrationSchema.parse({ firstName: "A", lastName: "B" }).answers).toEqual([]);
  });
});

describe("who can be re-invited (#1027)", () => {
  it("is a declined person who has not already been re-invited", () => {
    expect(invitationReinvitable({ approval: "DECLINED", supersededAt: null })).toBe(true);
    expect(invitationReinvitable({ approval: "DECLINED", supersededAt: new Date() })).toBe(false);
    expect(invitationReinvitable({ approval: "WAITING", supersededAt: null })).toBe(false);
    expect(invitationReinvitable({ approval: "APPROVED", supersededAt: null })).toBe(false);
    expect(invitationReinvitable({ approval: null, supersededAt: null })).toBe(false);
  });
});

describe("conference-paid meal counts by service (#1027)", () => {
  const row = (serviceId: string, group: CoveredMealRow["group"], personKey: string, date = "2027-06-16", time = "07:30"): CoveredMealRow => ({
    serviceId, serviceName: `Service ${serviceId}`, serviceDate: date, startTime: time, mealType: "BREAKFAST", group, personKey,
  });

  it("counts people per service and group, once each, in date and time order", () => {
    const counts = buildStaffMealServiceCounts([
      row("late", "STAFF", "a", "2027-06-17", "12:00"),
      row("early", "STAFF", "a"),
      row("early", "STAFF", "b"),
      row("early", "PASTOR", "c"),
      row("early", "PASTOR", "c"),
      row("early", "VOLUNTEER", "d"),
    ]);
    expect(counts.map((entry) => entry.serviceId)).toEqual(["early", "late"]);
    expect(counts[0]).toMatchObject({ counts: { STAFF: 2, PASTOR: 1, VOLUNTEER: 1 }, total: 4, mealLabel: "Breakfast" });
    expect(counts[1]).toMatchObject({ counts: { STAFF: 1, PASTOR: 0, VOLUNTEER: 0 }, total: 1 });
  });

  it("lists nothing, and writes no CSV rows, when nobody is covered", () => {
    expect(buildStaffMealServiceCounts([])).toEqual([]);
    expect(staffMealServiceCsvRows([])).toEqual([]);
  });

  it("appears in the kitchen report and its CSV, and only when there is something to show", () => {
    const counts = buildStaffMealServiceCounts([row("early", "STAFF", "a"), row("early", "PASTOR", "b")]);
    const report = buildKitchenReport([], counts);
    expect(report.conferenceMealServices).toHaveLength(1);
    const csv = kitchenReportCsv(report);
    expect(csv).toContain("Conference-paid meals by service");
    expect(csv).toContain('"Service date","Service","Meal","Staff","Pastor","Volunteer","Total"');
    expect(csv).toContain('"2027-06-16","Service early","Breakfast","1","1","0","2"');
    expect(kitchenReportCsv(buildKitchenReport([]))).not.toContain("Conference-paid meals by service");
  });
});

describe("the medical-data and wording rules (#1027 review)", () => {
  const asked = (fields: FieldInput[]) => staffEventQuestions(definition(fields)).map((entry) => entry.key);

  it("never asks a health-type or birth-date question, even one flagged sensitive: false", () => {
    expect(asked([field("allergies", { type: "LONG_TEXT", sensitive: false }), field("date_of_birth", { type: "DATE", sensitive: false }), field("hobby")])).toEqual(["hobby"]);
  });

  it("matches lodging words as whole words only", () => {
    expect(asked([field("ministry_interest", { label: "Potential ministry interest" }), field("tent_size", { label: "Contents of the tent" }), field("family_note", { label: "Household notes" }), field("housing_need", { label: "Housing" })])).toEqual(["ministry_interest", "family_note"]);
  });

  it("names the person in a required-answer problem", () => {
    const checked = checkPartyAnswers(form, [{ shirt_size: "Small", ministry_areas: ["Music"] }, { ministry_areas: ["Music"] }, { shirt_size: "Small" }], 3, ["You", "Spouse", "Child 1"]);
    expect(checked.problems).toEqual(["Spouse: Shirt size is required.", "Child 1: Ministry areas is required."]);
  });

  it("groups each person's questions under a legend naming them, with help outside the label and the group described", () => {
    const questions = staffEventQuestions(definition([field("shirt_size", { type: "RADIO", options: ["S", "M"], required: true, helpText: "Pick one." }), field("hobby", { helpText: "Anything." })])).map(toStaffQuestion);
    const html = renderToStaticMarkup(createElement(StaffInvitationQuestions, { answers: {}, idPrefix: "spouse", onChange: () => undefined, personLabel: "your spouse", questions }));
    expect(html).toContain("<legend>Questions for your spouse</legend>");
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-required="true"');
    expect(html).toContain('aria-describedby="spouse-shirt_size-help"');
    expect(html).not.toMatch(/<label[^>]*>[^<]*<input[^>]*id="spouse-hobby"[^>]*\/><small/);
    expect(html).toMatch(/<\/label><small class="field-help" id="spouse-hobby-help">Anything\.<\/small>/);
  });

  it("maps a refused re-invite to 409", () => {
    expect(staffInvitationErrorStatus("NOT_REINVITABLE")).toBe(409);
  });
});
