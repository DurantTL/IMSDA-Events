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

/**
 * What the step list at the top of the public form shows for each step.
 * Steps up to the furthest one reached are clickable (except the current step);
 * later steps stay plain. `errorStepIds` come from the full issue list of the
 * last submit or continue, so a step with errors is flagged even when another
 * step is showing.
 */
export function clickableSteps(
  steps: PublicRegistrationStep[],
  furthestIndex: number,
  currentIndex: number,
  errorStepIds: ReadonlySet<string> | readonly string[] = [],
): ClickableStep[] {
  const errors = new Set(errorStepIds);
  const furthest = Math.max(furthestIndex, currentIndex);
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
