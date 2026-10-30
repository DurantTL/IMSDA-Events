// Shared types, labels and small helpers for the registration form builder.
// Nothing here touches React state, so every zone of the editor can import it.

import { editDraftKey } from "@/lib/local-edit-draft";
import type { AddressValue } from "@/modules/forms/address";
import { getAttendeeRosterConfig, type ChoiceUsage, type RegistrationFormDefinition, type RegistrationFormField } from "@/modules/forms/definition";
import { getPublicRegistrationStepPlan } from "@/modules/forms/public-registration-steps";
import type { InformationBuilderConfig, InformationFormExtras } from "./information-mode";

export type PreviewValue = string | boolean | string[] | AddressValue;
export type TestSubmissionView = { id: string; isValid: boolean; submittedBy: string; createdAt: string; validation: Record<string, unknown>; responses: Record<string, unknown> };
export type FormVersionView = {
  id: string;
  versionNumber: number;
  status: string;
  definition: RegistrationFormDefinition;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  testSubmissionCount: number;
  choiceUsage: ChoiceUsage;
  testSubmissions: TestSubmissionView[];
};
export type FormView = {
  id: string;
  eventId: string;
  name: string;
  slug: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  /** Present only when the form has a known source template that has since changed. Forms with no source never have one. */
  templateNotice?: TemplateNoticeView | null;
  activeVersion: FormVersionView;
  versions: FormVersionView[];
  /** Information mode only (#1149): who may fill the form, when it opens and closes, and whether it is open. */
  information?: InformationFormExtras;
};
export type TemplateView = {
  key: string; name: string; description: string; audience: string; collectsPayment?: boolean; sectionCount: number; fieldCount: number;
  /** The template's latest version number, and the immutable id of that version (null when it is not stored yet). */
  version?: number | null;
  versionId?: string | null;
  /** How many of its acknowledgments still carry the placeholder wording (a template saved from a form). */
  placeholderAcknowledgments?: number;
};
/** The "template changed" notice (#1065): the form's source template has a newer, undismissed version. */
export type TemplateNoticeView = { templateKey: string; templateName: string; appliedVersion: number; latestVersion: number; latestVersionId: string };
export type DragState =
  | { kind: "section"; sectionIndex: number }
  | { kind: "field"; sectionIndex: number; fieldIndex: number }
  | null;

export const fieldTypeLabels: Record<RegistrationFormField["type"], string> = {
  TEXT: "Short text",
  LONG_TEXT: "Long answer",
  EMAIL: "Email",
  PHONE: "Phone",
  SELECT: "Dropdown",
  RADIO: "Single choice",
  MULTISELECT: "Multiple choice",
  RANKED_CHOICE: "Ranked choice",
  CHECKBOX: "Checkbox",
  ACKNOWLEDGMENT: "Recorded acknowledgment",
  SIGNATURE: "Signature (typed name)",
  DATE: "Date",
  NUMBER: "Number",
  CALCULATED: "Automatic fee",
  ADDRESS: "Address",
  MEMBER_LIST: "Member list",
};

export const choicePresets = [
  { name: "Yes / No", options: ["No", "Yes"] },
  { name: "Adult / Teen", options: ["Adult", "Teen"] },
  // `informationForm: false` keeps a preset out of information forms (#1149): dietary and payment choices are not asked there.
  { name: "Meal preference", options: ["Regular", "Vegetarian", "Vegan", "Gluten-free"], informationForm: false },
  { name: "Payment method", options: ["Pay Later", "Pay Now"], informationForm: false },
] as ReadonlyArray<{ name: string; options: string[]; informationForm?: boolean }>;

export const moduleCategories = ["All", "Common", "People", "Housing", "Group event"] as const;

export function fieldKey(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 50) || "new_field";
}

export function localId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

export function defaultField(index: number): RegistrationFormField {
  return { id: localId("field"), key: `new_field_${index}`, label: "New field", helpText: "", type: "TEXT", scope: "REGISTRATION", required: false, options: [] };
}

export type PreviewAttendee = {
  clientId: string;
  responses: Record<string, PreviewValue>;
};

export function blankPreviewAttendees(definition: RegistrationFormDefinition | null): PreviewAttendee[] {
  if (!definition) return [];
  const roster = getAttendeeRosterConfig(definition);
  if (!roster.enabled) return [];
  return Array.from({ length: roster.minAttendees }, (_, index) => ({
    clientId: `preview_initial_attendee_${index + 1}`,
    responses: {},
  }));
}

export function statusLabel(status: string) {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

export function firstPreviewStepId(definition: RegistrationFormDefinition) {
  return getPublicRegistrationStepPlan(definition)[0]?.id ?? "review";
}

export const conditionLabels = {
  EQUALS: "Equals",
  NOT_EQUALS: "Does not equal",
  INCLUDES: "Includes",
  NOT_EMPTY: "Has any answer",
} as const;

export type BuilderWorkspaceProps = {
  eventId: string;
  eventSlug: string;
  eventName: string;
  eventAudience?: string;
  eventBillingMode?: string;
  initialForms: FormView[];
  /** The event's Meals ticket plan prices in cents, keyed "LUNCH:ADULT" (#1139). A meal ticket field with a price here shows it read-only. */
  mealPlanPrices?: Record<string, number>;
  templates: TemplateView[];
  focusTarget?: { formId: string; fieldId: string } | null;
  canEditNotifications?: boolean;
  /** System administrators only (#1065); the server checks it again on every save. */
  canSaveAsTemplate?: boolean;
  /** For tests: `classic` uses the earlier layout (form list, section cards, preview column); `auto` (the default) uses the editor shell (#1132), which adapts to phone width (#1071). */
  layout?: "auto" | "classic";
  /** Information mode (#1149): the builder opens an information form instead of an event's registration form. Payment, roster, meals, attendee-type and pricing parts are left out, and every request goes to the information-forms API. */
  information?: InformationBuilderConfig;
};


/** Where the open form's unsaved definition is backed up in this browser (#1263). */
export function builderBackupKey(eventId: string, formId: string | null | undefined) {
  return editDraftKey("registration-builder", `${eventId}:${formId ?? ""}`);
}
