import { z } from "zod";
import { bundledSeededFormTemplates } from "@/modules/forms/seeded-template-data";
import { ACKNOWLEDGMENT_PLACEHOLDER_TEXT, formTemplates, type FormTemplate, type RegistrationFormDefinition } from "@/modules/forms/definition";

/**
 * The form template library (#1064): the pure parts. A form template is one
 * stored definition (name, description, audience and the same definition a
 * registration form version holds) with numbered, immutable versions. Template
 * versions hold form-definition configuration only: never meal plans, lodging
 * inventory, cancellation policies, messages, people, answers or registrations.
 */

/** Where a version came from: the code (`form-templates:sync`) or a system administrator's save in the app. */
export type FormTemplateSource = "CODE" | "APP";

export class FormTemplateError extends Error {
  constructor(
    public readonly code: "TEMPLATE_NOT_FOUND" | "TEMPLATE_UNREADABLE" | "VERSION_CONFLICT" | "TEMPLATE_BUSY" | "INVALID_TEMPLATE" | "FORM_NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "FormTemplateError";
  }
}

/** A code-defined form template and, for the seeded ones, the version its seed file declares. Templates without one are versioned by content. */
export type CodeFormTemplate = FormTemplate & { version: number | undefined };

/** Every template the code defines, in the picker's order: the seeded ones carry their seed-file version. */
export function codeFormTemplates(): CodeFormTemplate[] {
  return formTemplates.map((template) => ({ ...template, version: bundledSeededFormTemplates.find((seed) => seed.key === template.key)?.version }));
}

export function codeFormTemplate(key: string): CodeFormTemplate | null {
  return codeFormTemplates().find((template) => template.key === key) ?? null;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => [key, sortKeys(entry)]));
  }
  return value;
}

/** Equal templates serialize equally, whatever the key order or undefined properties. Compares the template's stored content, never its version. */
export function formTemplateSignature(template: { name: string; description: string; audience: string; definition: unknown }) {
  return JSON.stringify(sortKeys({ name: template.name, description: template.description, audience: template.audience, definition: template.definition }));
}

export const formTemplateKeyMaxLength = 60;

/** A stable key for a template an administrator creates in the app: lowercase letters, digits and underscores, never one the code or another template already uses. */
export function newFormTemplateKey(name: string, taken: ReadonlySet<string>) {
  const base = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, formTemplateKeyMaxLength - 9) || "form_template";
  // The app_ prefix keeps an app-created key from ever colliding with, or shadowing, a template key the code adds later.
  let key = `app_${base}`;
  for (let suffix = 2; taken.has(key); suffix += 1) key = `app_${base}_${suffix}`;
  return key;
}

export const saveFormTemplateSchema = z.object({
  /** The version the editor loaded. A save is refused when the template has moved on, so no version is silently overwritten. */
  expectedVersion: z.number().int().min(1),
  name: z.string().trim().min(1, "Enter a template name.").max(120),
  description: z.string().trim().max(500),
  audience: z.string().trim().min(1, "Enter who the template is for.").max(80),
  definition: z.unknown(),
}).strict();
export type SaveFormTemplateInput = z.infer<typeof saveFormTemplateSchema>;

export const copyFormTemplateSchema = z.object({
  sourceKey: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1, "Enter a name for the copy.").max(120),
}).strict();
export type CopyFormTemplateInput = z.infer<typeof copyFormTemplateSchema>;

/** One row of the Form templates page. */
export type FormTemplateLibraryEntry = {
  key: string;
  name: string;
  audience: string;
  /** The latest version number; null when the stored definition cannot be read. */
  version: number | null;
  source: FormTemplateSource;
  usedByForms: number;
  /** A stored definition that no longer validates. The picker skips an unreadable app-created template and uses the code's copy of a code template. */
  unreadable: boolean;
  /** An app-created template has no code copy. */
  appCreated: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
};

export type FormTemplateVersionEntry = { version: number; source: FormTemplateSource; createdAt: string; createdBy: string | null };

/** The wording a policy-version acknowledgment becomes in a template: a visible prompt for staff to replace, never a silent blank. */
export const templateAcknowledgmentPlaceholder = ACKNOWLEDGMENT_PLACEHOLDER_TEXT;

function policyVersionAcknowledgmentLabels(definition: RegistrationFormDefinition) {
  return definition.sections.flatMap((section) => section.fields)
    .filter((field) => field.type === "ACKNOWLEDGMENT" && field.acknowledgment?.source === "POLICY_VERSION")
    .map((field) => field.label);
}

/**
 * A form template belongs to no event, and a policy version belongs to one event, so a template carries typed wording only
 * (#1064). Every path that writes a template runs this: a save, a copy, and a save from a form.
 */
export function assertTemplateHasNoPolicyVersions(definition: RegistrationFormDefinition) {
  const [label] = policyVersionAcknowledgmentLabels(definition);
  if (label !== undefined) {
    throw new FormTemplateError("INVALID_TEMPLATE", `${label}: a form template cannot point an acknowledgment at a published policy version, because policy versions belong to one event. Type the wording here; staff can choose a policy version on the event's own form.`);
  }
}

/**
 * Saving an event's form as a template (#1065): each acknowledgment pointing at that event's published policy version becomes
 * a typed-wording acknowledgment with a placeholder, and its label is returned so the administrator is told which to reword.
 * The form itself is never changed; this works on a copy.
 */
export function replacePolicyVersionAcknowledgments(definition: RegistrationFormDefinition): { definition: RegistrationFormDefinition; replacedLabels: string[] } {
  const replacedLabels = policyVersionAcknowledgmentLabels(definition);
  if (replacedLabels.length === 0) return { definition, replacedLabels };
  const next = structuredClone(definition);
  for (const field of next.sections.flatMap((section) => section.fields)) {
    if (field.type === "ACKNOWLEDGMENT" && field.acknowledgment?.source === "POLICY_VERSION") {
      field.acknowledgment = { source: "TEXT", text: templateAcknowledgmentPlaceholder };
    }
  }
  return { definition: next, replacedLabels };
}

const formReference = {
  eventId: z.string().trim().min(1).max(100),
  formId: z.string().trim().min(1).max(100),
  /** The persisted form version to snapshot. Unsaved editor content is never sent: only what is stored is saved. */
  versionId: z.string().trim().min(1).max(100),
};

/** A system administrator turns a saved registration form version into a new template, or into the next version of an existing one (#1065). */
export const saveFormAsTemplateSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("NEW"),
    ...formReference,
    name: z.string().trim().min(1, "Enter a template name.").max(120),
    description: z.string().trim().max(500).default(""),
    audience: z.string().trim().min(1, "Enter who the template is for.").max(80),
  }).strict(),
  z.object({
    mode: z.literal("NEW_VERSION"),
    ...formReference,
    templateKey: z.string().trim().min(1).max(80),
    /** The template version the administrator saw; the save is refused when the template has moved on. */
    expectedVersion: z.number().int().min(1),
  }).strict(),
]);
export type SaveFormAsTemplateInput = z.infer<typeof saveFormAsTemplateSchema>;
