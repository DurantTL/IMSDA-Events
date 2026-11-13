import { describe, expect, it } from "vitest";
import {
  SEMINAR_NOT_ATTENDING,
  choiceDisplayLabel,
  isNotAttendingAnswer,
  isSeminarPreferenceField,
  realChoiceValues,
  registrationFormDefinitionSchema,
  validateTestResponses,
} from "@/modules/forms/definition";
import { buildRankedAssignmentPreview, programAssignmentRosterCsv, assignmentSourceFingerprint, type RankedAssignmentSource } from "@/modules/program-assignments/domain";
import { buildSeminarPreferencesBlock } from "@/modules/communications/message-blocks";
import { displayAnswer } from "@/modules/registration-pdf/model";
import { formatPublicRegistrationAnswer } from "@/modules/forms/public-registration-steps";
import { attendeeRosterExportRow, parseAttendeeRosterCsv } from "@/modules/forms/attendee-roster-csv";

const definition = registrationFormDefinitionSchema.parse({
  title: "Seminar form",
  description: "",
  confirmationMessage: "Done",
  attendeeRoster: { enabled: true, minAttendees: 1, maxAttendees: 5, attendeeLabel: "Attendee", addButtonLabel: "Add" },
  sections: [{
    id: "s_one",
    title: "Program",
    description: "",
    fields: [
      { id: "f_first", key: "first_name", label: "First name", helpText: "", type: "TEXT", scope: "ATTENDEE", required: true, options: [] },
      { id: "f_last", key: "last_name", label: "Last name", helpText: "", type: "TEXT", scope: "ATTENDEE", required: true, options: [] },
      { id: "f_friday", key: "friday_seminar", label: "Friday seminar", helpText: "", type: "RANKED_CHOICE", scope: "ATTENDEE", required: true, options: ["Prayer", "Service"], minSelections: 2, maxSelections: 2, availabilityMode: "RANKED_INTEREST", choiceLimits: { Prayer: 1, Service: 1 } },
      { id: "f_topics", key: "topics", label: "Topics", helpText: "", type: "MULTISELECT", scope: "ATTENDEE", required: false, options: ["A", "B"] },
    ],
  }],
});
const fields = definition.sections[0]!.fields;
const seminarField = fields.find((field) => field.key === "friday_seminar")!;
const topicsField = fields.find((field) => field.key === "topics")!;

function issues(responses: Record<string, unknown>) {
  return validateTestResponses(definition, { first_name: "Ana", last_name: "Rivera", ...responses }, {}, "ATTENDEE").issues.map((issue) => `${issue.key}: ${issue.message}`);
}

describe("Not attending seminar choice (#893)", () => {
  it("recognizes a seminar field and the stored marker", () => {
    expect(isSeminarPreferenceField(seminarField)).toBe(true);
    expect(isSeminarPreferenceField(topicsField)).toBe(false);
    expect(isNotAttendingAnswer([SEMINAR_NOT_ATTENDING])).toBe(true);
    expect(isNotAttendingAnswer([SEMINAR_NOT_ATTENDING, "Prayer"])).toBe(false);
    expect(isNotAttendingAnswer([])).toBe(false);
    expect(isNotAttendingAnswer(undefined)).toBe(false);
  });

  it("accepts Not attending alone for a required seminar field", () => {
    expect(issues({ friday_seminar: [SEMINAR_NOT_ATTENDING] })).toEqual([]);
  });

  it("still requires an answer, and keeps ordinary picks working", () => {
    expect(issues({})).toEqual(["friday_seminar: Friday seminar is required."]);
    expect(issues({ friday_seminar: ["Prayer"] })).toEqual(["friday_seminar: Friday seminar requires 2 choices."]);
    expect(issues({ friday_seminar: ["Prayer", "Service"] })).toEqual([]);
  });

  it("refuses Not attending mixed with seminar picks", () => {
    const [message] = issues({ friday_seminar: [SEMINAR_NOT_ATTENDING, "Prayer"] });
    expect(message).toContain("choose \"Not attending\" or pick seminars, not both");
  });

  it("rejects the marker on a field that is not a seminar field", () => {
    expect(issues({ friday_seminar: ["Prayer", "Service"], topics: [SEMINAR_NOT_ATTENDING] })).toEqual(["topics: Topics contains an invalid choice."]);
  });

  it("keeps a removed or invalid seminar option invalid", () => {
    expect(issues({ friday_seminar: ["Prayer", "Gone"] })).toEqual(["friday_seminar: Friday seminar contains an invalid choice."]);
  });

  it("never turns the marker into a selection row value", () => {
    expect(realChoiceValues([SEMINAR_NOT_ATTENDING])).toEqual([]);
    expect(realChoiceValues(["Prayer", "Service"])).toEqual(["Prayer", "Service"]);
    expect(realChoiceValues("Prayer")).toEqual(["Prayer"]);
    expect(realChoiceValues(undefined)).toEqual([]);
  });

  it("shows a readable label, never the raw marker", () => {
    expect(choiceDisplayLabel(SEMINAR_NOT_ATTENDING)).toBe("Not attending");
    expect(choiceDisplayLabel("Prayer")).toBe("Prayer");
    expect(displayAnswer(seminarField, [SEMINAR_NOT_ATTENDING])).toBe("Not attending");
    expect(displayAnswer(seminarField, ["Prayer", "Service"])).toBe("1. Prayer  2. Service");
    expect(formatPublicRegistrationAnswer([SEMINAR_NOT_ATTENDING])).toBe("Not attending");
    expect(attendeeRosterExportRow(definition, { friday_seminar: [SEMINAR_NOT_ATTENDING] })[2]).toBe("Not attending");
    expect(buildSeminarPreferencesBlock([{
      name: "Ana Rivera",
      fields: [{ label: "Friday seminar", choices: [], assigned: [], notAttending: true }],
    }])).toBe("**Ana Rivera**\n- Not attending");
  });

  it("accepts Not attending in a roster file for a seminar column only", () => {
    const parsed = parseAttendeeRosterCsv("first_name,last_name,friday_seminar\nAna,Rivera,Not attending\n", definition);
    expect(JSON.stringify(parsed)).toContain(SEMINAR_NOT_ATTENDING);
    expect(() => parseAttendeeRosterCsv("first_name,last_name,topics\nAna,Rivera,Not attending\n", definition)).toThrow();
  });
});

function source(participants: RankedAssignmentSource["participants"]): RankedAssignmentSource {
  return {
    eventId: "event_one",
    formId: "form_one",
    formName: "Retreat",
    formVersionId: "version_one",
    formVersionNumber: 1,
    fieldId: "f_friday",
    fieldKey: "friday_seminar",
    fieldLabel: "Friday seminar",
    options: ["Prayer", "Service"],
    choiceLimits: { Prayer: 1, Service: 1 },
    participants,
  };
}

function person(attendeeId: string, preferences: unknown, position = 0) {
  return {
    attendeeId,
    registrationId: `registration_${attendeeId}`,
    registrationStatus: "SUBMITTED" as const,
    confirmationCode: `REG-${attendeeId.toUpperCase()}`,
    submittedAt: "2027-06-01T10:00:00.000Z",
    attendeePosition: position,
    firstName: attendeeId,
    lastName: "Attendee",
    attendeeType: "Adult",
    preferences,
  };
}

describe("seminar assignment with Not attending (#893)", () => {
  const people = [
    person("ana", ["Prayer", "Service"]),
    person("ben", [SEMINAR_NOT_ATTENDING], 1),
    person("cy", [], 2),
  ];

  it("leaves them out of the run and counts them apart from unassigned", () => {
    const preview = buildRankedAssignmentPreview(source(people));
    expect(preview.assignments.map((assignment) => assignment.attendeeId)).toEqual(["ana", "cy"]);
    expect(preview.summary).toMatchObject({ attendees: 2, assigned: 1, unassigned: 1, noRankedChoices: 1, notAttending: 1 });
    // Not attending takes no seat: Prayer still has its one seat for Ana, Service is untouched.
    expect(preview.choices.find((choice) => choice.option === "Service")).toMatchObject({ demand: 1, assigned: 0 });
  });

  it("keeps a missing answer distinct from Not attending", () => {
    const preview = buildRankedAssignmentPreview(source([person("cy", undefined)]));
    expect(preview.summary).toMatchObject({ noRankedChoices: 1, notAttending: 0 });
  });

  it("changes the source fingerprint when someone moves to Not attending", () => {
    const before = assignmentSourceFingerprint(source([person("ben", undefined)]));
    const after = assignmentSourceFingerprint(source([person("ben", [SEMINAR_NOT_ATTENDING])]));
    expect(after).not.toBe(before);
  });

  it("states the count on the roster CSV", () => {
    const preview = buildRankedAssignmentPreview(source(people));
    const csv = programAssignmentRosterCsv({
      id: "run_one",
      eventName: "Retreat",
      formName: "Retreat",
      formVersionNumber: 1,
      fieldLabel: "Friday seminar",
      appliedAt: "2027-06-02T10:00:00.000Z",
      appliedByName: "Staff",
      notAttending: preview.summary.notAttending,
      assignments: preview.assignments,
    });
    expect(csv).toContain(`"Not attending (not placed)","1"`);
  });
});
