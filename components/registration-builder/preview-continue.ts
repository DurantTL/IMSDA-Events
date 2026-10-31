// Preview Continue validation and the failed-test summary (#1407). The checks are the
// public form's own: validateTestResponses and validateRosterResponses, filtered to the
// step with the same rule (issueBelongsToPlanStep) the public form's Continue uses.
import { validateTestResponses, type AttendeeRosterConfig, type ChoiceUsage, type RegistrationFormDefinition } from "@/modules/forms/definition";
import { issueBelongsToPlanStep, type PublicRegistrationStep } from "@/modules/forms/public-registration-steps";
import { validateRosterResponses } from "@/modules/forms/roster-validation";
import type { PreviewAttendee, PreviewValue, TestSubmissionView } from "./builder-types";

export type PreviewIssue = { fieldId: string | null; key: string; message: string; attendeeIndex?: number | null; path?: string };

export type ContinueBlock = { stepId: string; message: string; attempt: number };

/** The next block state after a blocked Continue: same wording, but a new attempt so the alert is announced again. */
export function nextContinueBlock(previous: ContinueBlock | null, step: Pick<PublicRegistrationStep, "id" | "shortLabel">): ContinueBlock {
  return { stepId: step.id, message: continueBlockedMessage(step), attempt: (previous?.attempt ?? 0) + 1 };
}

/** Issues with no field to highlight (the attendee count): the alert shows their text instead. */
export function fieldlessIssues(issues: readonly PreviewIssue[]) {
  return issues.filter((issue) => issue.key === "attendees" || !issue.fieldId);
}

/** What is wrong on this preview step, exactly as the public form's Continue would find it. */
export function previewStepIssues(input: {
  definition: RegistrationFormDefinition;
  roster: AttendeeRosterConfig | null;
  responses: Record<string, PreviewValue>;
  attendees: readonly PreviewAttendee[];
  choiceUsage: ChoiceUsage;
  step: PublicRegistrationStep;
}): PreviewIssue[] {
  const { definition, roster, responses, attendees, choiceUsage, step } = input;
  const all: PreviewIssue[] = roster?.enabled
    ? validateRosterResponses({ definition, roster, registrationResponses: responses, attendees, choiceUsage })
        .map((issue) => ({ ...issue, fieldId: issue.fieldId ?? null }))
    : validateTestResponses(definition, responses, choiceUsage).issues
        .map((issue) => ({ ...issue, attendeeIndex: null }));
  return all.filter((issue) => issueBelongsToPlanStep(issue, step));
}

/** The public form's wording for a blocked Continue. */
export function continueBlockedMessage(step: Pick<PublicRegistrationStep, "shortLabel">) {
  return `Complete ${step.shortLabel.toLowerCase()} before continuing.`;
}

/** Plain-word reasons from the newest test, only when it failed and no test of this version has passed. */
export function lastFailedTestReasons(testSubmissions: readonly TestSubmissionView[], attendeeLabel: string | null): string[] {
  if (testSubmissions.some((submission) => submission.isValid)) return [];
  const newest = testSubmissions[0];
  if (!newest || newest.isValid) return [];
  const issues = Array.isArray(newest.validation?.issues) ? newest.validation.issues as Array<{ message?: unknown; attendeeIndex?: unknown }> : [];
  return issues.flatMap((issue) => {
    if (!issue || typeof issue.message !== "string" || !issue.message) return [];
    return [typeof issue.attendeeIndex === "number" ? `${attendeeLabel ?? "Attendee"} ${issue.attendeeIndex + 1}: ${issue.message}` : issue.message];
  });
}
