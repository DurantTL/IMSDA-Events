import type { RegistrationFormDefinition } from "@/modules/forms/definition";
import { builderFieldModules } from "@/modules/forms/builder-modules";

/**
 * The module bundles whose field keys are fixed contracts (#1064): the roster, meal,
 * housing and campsite reports, the promo-code and attendee-roster wiring read these keys by
 * name. The template editor names the fields on a template that belong to one, so an
 * administrator edits their wording and prices, not their keys.
 */
const fixedKeyModuleKeys = ["guest_roster", "housing", "attendee_housing", "campsite", "meal_tickets", "promo_code"] as const;

export type ModuleOwnedField = { fieldKey: string; label: string; moduleName: string };

export function moduleOwnedFields(definition: RegistrationFormDefinition): ModuleOwnedField[] {
  const owner = new Map<string, string>();
  for (const bundle of builderFieldModules) {
    if (!(fixedKeyModuleKeys as readonly string[]).includes(bundle.key)) continue;
    for (const field of bundle.fields) if (!owner.has(field.key)) owner.set(field.key, bundle.name);
  }
  return definition.sections.flatMap((section) => section.fields.flatMap((field) => {
    const moduleName = owner.get(field.key);
    return moduleName ? [{ fieldKey: field.key, label: field.label, moduleName }] : [];
  }));
}
