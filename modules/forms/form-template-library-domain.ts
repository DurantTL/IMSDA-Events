import { z } from "zod";
import { bundledSeededFormTemplates } from "@/modules/forms/seeded-template-data";
import { formTemplates, type FormTemplate } from "@/modules/forms/definition";

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
    public readonly code: "TEMPLATE_NOT_FOUND" | "TEMPLATE_UNREADABLE" | "VERSION_CONFLICT" | "TEMPLATE_BUSY" | "INVALID_TEMPLATE",
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
