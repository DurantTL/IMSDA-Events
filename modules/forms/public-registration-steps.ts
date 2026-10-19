import { formatAddressDisplay, isPlainAddressObject } from "@/modules/forms/address";
import type {
  RegistrationFormDefinition,
  RegistrationFormField,
} from "@/modules/forms/definition";

export type PublicRegistrationStepId = string;

export type PublicRegistrationStep = {
  id: PublicRegistrationStepId;
  shortLabel: string;
  title: string;
  description: string;
  fieldKeys: string[];
  sectionId: string | null;
  isReview: boolean;
  managesAttendees: boolean;
  /** The lodging step (#199): shown before review on events that collect lodging; its answers travel beside the form's own. */
  isLodging?: boolean;
};

const attendeeIdentityTerms = [
  "attendee_name",
  "first_name",
  "last_name",
  "full_name",
  "guest_name",
  "member_name",
  "age",
  "birth",
  "gender",
  "attendee_type",
  "role",
  "guardian",
  "attendee_phone",
  "attendee_email",
];

function fieldLooksLikeAttendeeIdentity(field: RegistrationFormField) {
  const searchText = `${field.key} ${field.label}`.toLowerCase();
  return attendeeIdentityTerms.some((term) => searchText.includes(term));
}

function legacyReviewSection(
  definition: RegistrationFormDefinition,
  section: RegistrationFormDefinition["sections"][number],
) {
  if (definition.sections.at(-1)?.id !== section.id) return false;
  const title = section.title.toLowerCase();
  if (["payment", "review", "checkout", "acknowledg"].some((term) => title.includes(term))) {
    return true;
  }
  return section.fields.some((field) => (
    field.key === definition.payment?.paymentMethodFieldKey
    || field.key === "promo_code"
  ));
}

export function isPublicReviewSection(
  definition: RegistrationFormDefinition,
  section: RegistrationFormDefinition["sections"][number],
) {
  const hasExplicitSetting = definition.sections.some((candidate) => (
    candidate.isReviewStep !== undefined
  ));
  if (hasExplicitSetting) return section.isReviewStep === true;
  return legacyReviewSection(definition, section);
}

export function getPublicRegistrationStepPlan(
  definition: RegistrationFormDefinition,
  visibleFieldKeys?: ReadonlySet<string>,
  options: { lodging?: boolean } = {},
): PublicRegistrationStep[] {
  const sectionSteps = definition.sections.flatMap((section) => {
    const fieldKeys = section.fields
      .filter((field) => !visibleFieldKeys || visibleFieldKeys.has(field.key))
      .map((field) => field.key);
    const isReview = isPublicReviewSection(definition, section);
    if (fieldKeys.length === 0 && !isReview) return [];
    return [{
      id: section.id,
      shortLabel: section.stepLabel ?? section.title.slice(0, 40),
      title: section.title,
      description: section.description,
      fieldKeys,
      sectionId: section.id,
      isReview,
      managesAttendees: false,
    }];
  });

  const lodgingStep: PublicRegistrationStep[] = options.lodging
    ? [{
        id: "__lodging",
        shortLabel: "Lodging",
        title: "Where you will stay",
        description: "Choose a lodging type and nights, and ask to room with someone. Full types cannot be picked.",
        fieldKeys: [],
        sectionId: null,
        isReview: false,
        managesAttendees: false,
        isLodging: true,
      }]
    : [];
  const reviewStep = sectionSteps.find((step) => step.isReview);
  const orderedSteps = reviewStep
    ? [
        ...sectionSteps.filter((step) => step.id !== reviewStep.id),
        ...lodgingStep,
        reviewStep,
      ]
    : [
        ...sectionSteps,
        ...lodgingStep,
        {
          id: "__review",
          shortLabel: "Review",
          title: definition.payment?.enabled ? "Review & payment" : "Review & submit",
          description: "Check every answer before sending this registration.",
          fieldKeys: [],
          sectionId: null,
          isReview: true,
          managesAttendees: false,
        },
      ];

  const firstIdentityStepIndex = orderedSteps.findIndex((step) => {
    if (!step.sectionId) return false;
    const section = definition.sections.find((candidate) => candidate.id === step.sectionId);
    return section?.fields.some((field) => (
      field.scope === "ATTENDEE" && fieldLooksLikeAttendeeIdentity(field)
    ));
  });
  const firstAttendeeStepIndex = firstIdentityStepIndex >= 0
    ? firstIdentityStepIndex
    : orderedSteps.findIndex((step) => {
        if (!step.sectionId) return false;
        const section = definition.sections.find((candidate) => candidate.id === step.sectionId);
        return section?.fields.some((field) => field.scope === "ATTENDEE");
      });

  return orderedSteps.map((step, index) => ({
    ...step,
    managesAttendees: index === firstAttendeeStepIndex,
  }));
}

export function formatPublicRegistrationAnswer(
  value: unknown,
) {
  if (Array.isArray(value)) return value.length > 0 ? value.join(" → ") : null;
  if (typeof value === "boolean") return value ? "Accepted" : "Not accepted";
  if (typeof value === "string") return value.trim() || null;
  if (isPlainAddressObject(value)) return formatAddressDisplay(value) || null;
  return null;
}

export type ClickableStep = {
  step: PublicRegistrationStep;
  index: number;
  isCurrent: boolean;
  isComplete: boolean;
  /** Reached before (and not the one showing): the step list renders it as a button. */
  clickable: boolean;
  hasErrors: boolean;
  /** Accessible name for the button, e.g. "Go to step 2: Team members, has errors". */
  label: string;
};

type IssueLike = { key: string; path?: string };

/** Does this issue belong to this step? One rule for the form, the markers and the tests. */
export function issueBelongsToPlanStep(issue: IssueLike, step: PublicRegistrationStep) {
  if (issue.key === "attendees" || issue.path === "attendees") return step.managesAttendees;
  if (issue.key === "lodging") return step.isLodging === true;
  return step.fieldKeys.includes(issue.key);
}

/** Remember a step the person has been on, by id, so a section appearing or going away cannot shift which steps are reached. */
export function withVisitedStep(visited: readonly string[], stepId: string): string[] {
  return visited.includes(stepId) ? [...visited] : [...visited, stepId];
}

/**
 * Index of the furthest step reached in the current plan: the last step, by
 * position now, that was visited. Steps whose section went away are ignored.
 */
export function furthestReachedIndex(
  steps: PublicRegistrationStep[],
  visitedStepIds: readonly string[],
  currentIndex: number,
) {
  const visited = new Set(visitedStepIds);
  let furthest = currentIndex;
  steps.forEach((step, index) => {
    if (visited.has(step.id)) furthest = Math.max(furthest, index);
  });
  return furthest;
}

/**
 * Which steps get an error marker. Client issues count only for steps where a
 * failed Continue or Submit already showed errors (a step the person just
 * arrived on is not an error yet); server
 * issues count wherever they land. Computed live, so a step that now passes
 * loses its marker and a scoped Continue never drops another step's marker.
 */
export function errorMarkedStepIds(
  steps: PublicRegistrationStep[],
  options: {
    /** Steps where a failed Continue or Submit already showed the person their errors. */
    attemptedStepIds: readonly string[];
    clientIssues: readonly IssueLike[];
    serverIssues: readonly IssueLike[];
  },
): string[] {
  const attempted = new Set(options.attemptedStepIds);
  return steps
    .filter((step) => (
      (attempted.has(step.id)
        && options.clientIssues.some((issue) => issueBelongsToPlanStep(issue, step)))
      || options.serverIssues.some((issue) => issueBelongsToPlanStep(issue, step))
    ))
    .map((step) => step.id);
}

/** Server issues still unresolved after the person got past `stepId` (Continue from it passed). */
export function withoutServerIssuesForStep<T extends IssueLike>(
  serverIssues: readonly T[],
  step: PublicRegistrationStep,
): T[] {
  return serverIssues.filter((issue) => !issueBelongsToPlanStep(issue, step));
}

/**
 * What the step list at the top of the public form shows for each step.
 * Steps up to the furthest one reached are clickable (except the current step);
 * later steps stay plain.
 */
export function clickableSteps(
  steps: PublicRegistrationStep[],
  visitedStepIds: readonly string[],
  currentIndex: number,
  errorStepIds: ReadonlySet<string> | readonly string[] = [],
): ClickableStep[] {
  const errors = new Set(errorStepIds);
  const furthest = furthestReachedIndex(steps, visitedStepIds, currentIndex);
  return steps.map((step, index) => {
    const hasErrors = errors.has(step.id);
    const isCurrent = index === currentIndex;
    return {
      step,
      index,
      isCurrent,
      isComplete: index < currentIndex,
      clickable: !isCurrent && index <= furthest,
      hasErrors,
      label: `Go to step ${index + 1}: ${step.shortLabel}${hasErrors ? ", has errors" : ""}`,
    };
  });
}
