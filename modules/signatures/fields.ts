import type { RegistrationFormDefinition, RegistrationFormField } from "@/modules/forms/definition";

/**
 * The client-safe pieces of typed-name signatures (#1265): nothing from node:, so the registration form can import them in
 * the browser bundle. `domain.ts` re-exports everything here for server callers.
 */

/** Every signature field of a definition, in form order. */
export function signatureFields(definition: RegistrationFormDefinition): RegistrationFormField[] {
  return definition.sections.flatMap((section) => section.fields).filter((field) => field.type === "SIGNATURE");
}
