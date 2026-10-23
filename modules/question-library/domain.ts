import { z } from "zod";
import { ACKNOWLEDGMENT_PLACEHOLDER_TEXT, formFieldSchema, isAgeFieldKey, type RegistrationFormField } from "@/modules/forms/definition";
import { builderFieldModules, promoCodeBuilderModule } from "@/modules/forms/builder-modules";
import { isHealthTypeField, resolveFieldOffer } from "@/modules/forms/field-flags";
import { mealTicketBinding } from "@/modules/meals/domain";

/**
 * The question library (#1070): the pure parts. A saved question is configuration only: one or more form fields kept as a
 * fragment `{ fields: [...] }`, validated with the form definition's own field schema. It never holds answers, people,
 * registrations or any other operational record, and adding one to a form inserts an independent copy.
 *
 * Who may do what (Caleb's decision on #1070): anyone who can build forms (system administrators, and event staff with
 * MANAGE_FORMS on their event) saves and adds; only system administrators rename, edit or delete. The routes enforce it.
 */

export const MAX_LIBRARY_FIELDS = 20;

export class QuestionLibraryError extends Error {
  constructor(public readonly code: "ITEM_NOT_FOUND" | "INVALID_ITEM", message: string) {
    super(message);
    this.name = "QuestionLibraryError";
  }
}

export type QuestionLibraryFragment = { fields: RegistrationFormField[] };

export const questionLibraryFragmentSchema = z.object({
  fields: z.array(formFieldSchema).min(1, "Choose at least one question to save.").max(MAX_LIBRARY_FIELDS, `A saved question holds at most ${MAX_LIBRARY_FIELDS} fields.`),
}).strict();

const nameSchema = z.string().trim().min(1, "Enter a name for the saved question.").max(120);
const descriptionSchema = z.string().trim().max(500);

export const saveLibraryItemSchema = z.object({
  /** The event the person builds forms for. Staff are checked for MANAGE_FORMS on it; without one only a system administrator may save. */
  eventId: z.string().trim().min(1).max(100).nullish(),
  name: nameSchema,
  description: descriptionSchema.default(""),
  fields: z.array(z.unknown()),
}).strict();

export const updateLibraryItemSchema = z.object({
  name: nameSchema.optional(),
  description: descriptionSchema.optional(),
  fields: z.array(z.unknown()).optional(),
}).strict().refine((value) => value.name !== undefined || value.description !== undefined || value.fields !== undefined, { message: "Change the name, the description or the questions." });

/** Keys other code reads by name, or that a singleton module owns. A saved question can never carry one: it would not be an independent copy. */
const moduleOwnedKeys: ReadonlySet<string> = new Set([
  promoCodeBuilderModule.key,
  ...builderFieldModules.filter((module) => module.singleton).flatMap((module) => module.fields.map((field) => field.key)),
]);

/** Why a field cannot be a saved question, or null. Specialized module bundles and canonical keys are not arbitrary saved questions. */
export function protectedFieldReason(field: Pick<RegistrationFormField, "key" | "label" | "optionSource">): string | null {
  if (field.key === "promo_code" || moduleOwnedKeys.has(field.key)) return `"${field.label}" belongs to a ready-made module. Add that module from the Questions list instead.`;
  if (mealTicketBinding(field.key) !== null) return `"${field.label}" is a meal ticket question wired to the Meals plan, so it cannot be saved to the library.`;
  if (isAgeFieldKey(field.key)) return `"${field.label}" is an age question the roster reads by key, so it cannot be saved to the library.`;
  if (field.optionSource === "ATTENDEE_TYPES") return `"${field.label}" is the attendee type selector, which the form owns, so it cannot be saved to the library.`;
  return null;
}

/**
 * Validates fields for storage and returns the fragment to store. Every path that writes a library item runs this:
 * the same field schema forms use; no protected module or canonical keys; an acknowledgment that points at an event's
 * policy version becomes placeholder wording (policy versions belong to one event); and a health-type question is stored
 * as explicitly sensitive, so saving can never turn a sensitive question into a non-sensitive one.
 */
export function prepareLibraryFragment(raw: unknown): { fragment: QuestionLibraryFragment; replacedAcknowledgments: string[] } {
  const parsed = questionLibraryFragmentSchema.safeParse({ fields: raw });
  if (!parsed.success) throw new QuestionLibraryError("INVALID_ITEM", parsed.error.issues[0]?.message ?? "These questions cannot be saved.");
  const keys = new Set<string>();
  const replacedAcknowledgments: string[] = [];
  const fields = parsed.data.fields.map((field): RegistrationFormField => {
    const reason = protectedFieldReason(field);
    if (reason) throw new QuestionLibraryError("INVALID_ITEM", reason);
    if (keys.has(field.key)) throw new QuestionLibraryError("INVALID_ITEM", `Two of these questions use the key "${field.key}".`);
    keys.add(field.key);
    let next: RegistrationFormField = structuredClone(field);
    if (next.type === "ACKNOWLEDGMENT" && next.acknowledgment?.source === "POLICY_VERSION") {
      replacedAcknowledgments.push(next.label);
      next = { ...next, acknowledgment: { source: "TEXT", text: ACKNOWLEDGMENT_PLACEHOLDER_TEXT } };
    }
    // An explicit "not sensitive" on wording that reads as health-type is not carried into the library.
    if (isHealthTypeField(next)) next.sensitive = true;
    return next;
  });
  // Restrictions never loosen: a sensitive question is never a filter, and a question that depends on a
  // sensitive question in this item is stored sensitive and not a filter. The form's own check decides, so there is no second rule.
  const restricted = fields.map((candidate) => {
    const offer = resolveFieldOffer(candidate, { allFields: fields, sectionTitleOf: () => "", paymentMethodFieldKey: null });
    return offer.sensitive ? { ...candidate, sensitive: true, filterable: false } : candidate;
  });
  return { fragment: { fields: restricted }, replacedAcknowledgments };
}

/** Reads a stored fragment; null when it can no longer be read (a stored item is listed as unreadable, never inserted). */
export function readLibraryFragment(raw: unknown): QuestionLibraryFragment | null {
  const parsed = questionLibraryFragmentSchema.safeParse(raw);
  return parsed.success ? (parsed.data as QuestionLibraryFragment) : null;
}

/** What the palette shows about one item. Configuration only. */
export type QuestionLibraryItemView = {
  id: string;
  name: string;
  description: string;
  fields: RegistrationFormField[];
  createdAt: string;
  updatedAt: string;
};

/** What the administrator's management list shows. An unreadable item is listed and flagged, never hidden. */
export type QuestionLibraryAdminRow = Omit<QuestionLibraryItemView, "fields"> & { createdBy: string | null; fieldCount: number; fieldLabels: string[]; unreadable: boolean };
