// Client-side roster validation, shared by the public registration form and the
// builder's preview so both block Continue on the same rules (#1407).
import { pluralAttendeeLabel } from "@/modules/forms/attendee-label";
import {
  getAvailabilityMode,
  isFieldVisible,
  validateTestResponses,
  type AttendeeRosterConfig,
  type ChoiceUsage,
  type RegistrationFormDefinition,
  type RegistrationFormField,
} from "@/modules/forms/definition";

export type RosterValidationIssue = {
  key: string;
  message: string;
  fieldId?: string | null;
  path: string;
  attendeeIndex: number | null;
};

export function cloneChoiceUsage(definition: RegistrationFormDefinition, usage: ChoiceUsage): ChoiceUsage {
  const clone: ChoiceUsage = {};
  for (const section of definition.sections) {
    for (const field of section.fields) {
      if (getAvailabilityMode(field) === "NONE") continue;
      clone[field.key] = Object.fromEntries(field.options.map((option) => {
        const stats = usage[field.key]?.[option] ?? { total: 0, first: 0, second: 0 };
        return [option, { ...stats }];
      }));
    }
  }
  return clone;
}

export function addResponsesToUsage(
  definition: RegistrationFormDefinition,
  responses: Record<string, unknown>,
  usage: ChoiceUsage,
  scope: RegistrationFormField["scope"],
) {
  for (const section of definition.sections) {
    for (const field of section.fields) {
      if (field.scope !== scope || getAvailabilityMode(field) === "NONE" || !isFieldVisible(field, responses)) continue;
      const value = responses[field.key];
      const selections = Array.isArray(value)
        ? value
        : typeof value === "string" && value
          ? [value]
          : [];
      selections.forEach((option, rank) => {
        const stats = usage[field.key]?.[option];
        if (!stats) return;
        stats.total += 1;
        if (rank === 0) stats.first += 1;
        if (rank === 1) stats.second += 1;
      });
    }
  }
}

/** Validates the attendee count, the once-asked answers and each attendee's answers, in that order. */
export function validateRosterResponses(input: {
  definition: RegistrationFormDefinition;
  roster: AttendeeRosterConfig;
  registrationResponses: Record<string, unknown>;
  attendees: ReadonlyArray<{ clientId: string; responses: Record<string, unknown> }>;
  choiceUsage: ChoiceUsage;
  ignoredFieldKeys?: readonly string[];
  /** Answers already stored per attendee clientId (#855). */
  previousResponses?: Record<string, Record<string, unknown>>;
}): RosterValidationIssue[] {
  const { definition, roster, registrationResponses, attendees, ignoredFieldKeys } = input;
  const nextIssues: RosterValidationIssue[] = [];
  if (attendees.length < roster.minAttendees || attendees.length > roster.maxAttendees) {
    nextIssues.push({
      key: "attendees",
      path: "attendees",
      attendeeIndex: null,
      message: `Add between ${roster.minAttendees} and ${roster.maxAttendees} ${pluralAttendeeLabel(roster.attendeeLabel, roster.maxAttendees)}.`,
    });
  }
  const projectedUsage = cloneChoiceUsage(definition, input.choiceUsage);
  const registrationValidation = validateTestResponses(
    definition,
    registrationResponses,
    projectedUsage,
    "REGISTRATION",
    { ignoredFieldKeys },
  );
  nextIssues.push(...registrationValidation.issues.map((issue) => ({
    ...issue,
    path: `responses.${issue.key}`,
    attendeeIndex: null,
  })));
  addResponsesToUsage(definition, registrationResponses, projectedUsage, "REGISTRATION");
  attendees.forEach((attendee, attendeeIndex) => {
    const merged = { ...registrationResponses, ...attendee.responses };
    const validation = validateTestResponses(
      definition,
      merged,
      projectedUsage,
      "ATTENDEE",
      {
        previousResponses: input.previousResponses?.[attendee.clientId],
        ignoredFieldKeys,
      },
    );
    nextIssues.push(...validation.issues.map((issue) => ({
      ...issue,
      path: `attendees.${attendeeIndex}.responses.${issue.key}`,
      attendeeIndex,
    })));
    addResponsesToUsage(definition, merged, projectedUsage, "ATTENDEE");
  });
  return nextIssues;
}
