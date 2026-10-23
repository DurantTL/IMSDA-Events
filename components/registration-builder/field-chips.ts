// The compact chips on a canvas question card (#1139). Derived only from the
// question's own definition data, so they can never disagree with what the form
// does. Pure, so the rules are testable without a browser.
import type { RegistrationFormField } from "@/modules/forms/definition";
import { resolveFieldFlags } from "@/modules/forms/field-flags";
import { builderFieldModules } from "@/modules/forms/builder-modules";
import { isMealTicketField } from "./module-owned-settings";
import { hasVisibilityRule } from "@/modules/forms/visibility-rule";

export type FieldChipKind = "scope" | "required" | "logic" | "price" | "capacity" | "sensitive" | "module";
export type FieldChip = { kind: FieldChipKind; label: string };

/** The module a question came from: Meals for a meal ticket, else the palette module that carries its key (never the generic Common ones). */
export function sourceModuleName(field: Pick<RegistrationFormField, "key" | "type" | "scope">): string | null {
  if (isMealTicketField(field)) return "Meals";
  const found = builderFieldModules.find((module) => module.category !== "Common" && module.fields.some((moduleField) => moduleField.key === field.key && moduleField.type === field.type));
  return found?.name ?? null;
}

/** Whether the question changes what a registrant pays: a price, a price per choice, a late price or a credit. */
export function affectsPrice(field: RegistrationFormField) {
  return field.priceCents !== undefined
    || Object.keys(field.choicePricesCents ?? {}).length > 0
    || Boolean(field.latePricing)
    || field.creditCentsPerUnit !== undefined;
}

/** Whether any choice has a limit. */
export function hasCapacity(field: RegistrationFormField) {
  return Object.keys(field.choiceLimits ?? {}).length > 0;
}

/**
 * In information mode (#1149) a question is never priced, limited, per person or sensitive, and comes from no module's
 * price plan, so only Required and Has logic describe it.
 */
export function deriveFieldChips(field: RegistrationFormField, sectionTitle = "", { information = false }: { information?: boolean } = {}): FieldChip[] {
  if (information) {
    const chips: FieldChip[] = [];
    if (field.required) chips.push({ kind: "required", label: "Required" });
    if (hasVisibilityRule(field)) chips.push({ kind: "logic", label: "Has logic" });
    return chips;
  }
  const chips: FieldChip[] = [{ kind: "scope", label: field.scope === "ATTENDEE" ? "Asked of each person" : "Asked once" }];
  if (field.required || field.optionSource === "ATTENDEE_TYPES") chips.push({ kind: "required", label: "Required" });
  if (hasVisibilityRule(field)) chips.push({ kind: "logic", label: "Has logic" });
  if (affectsPrice(field)) chips.push({ kind: "price", label: "Has price" });
  if (hasCapacity(field)) chips.push({ kind: "capacity", label: "Has capacity" });
  if (resolveFieldFlags(field, { sectionTitle }).sensitive) chips.push({ kind: "sensitive", label: "Sensitive" });
  const source = sourceModuleName(field);
  if (source) chips.push({ kind: "module", label: `From ${source}` });
  return chips;
}
