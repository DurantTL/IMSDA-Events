import type { RegistrationFormDefinition, RegistrationFormField } from "@/modules/forms/definition";

/**
 * The client-safe pieces of acknowledgment evidence (#150): no hashing and nothing from node:, so the registration form can
 * import them in the browser bundle. `domain.ts` re-exports everything here for server callers.
 */

/** Every acknowledgment field of a definition, in form order. */
export function acknowledgmentFields(definition: RegistrationFormDefinition): RegistrationFormField[] {
  return definition.sections.flatMap((section) => section.fields).filter((field) => field.type === "ACKNOWLEDGMENT");
}

/** What a public form or preview renders for one acknowledgment: never evidence, only the wording. */
export type AcknowledgmentDisplay = {
  source: "TEXT" | "POLICY_VERSION";
  title: string | null;
  text: string;
  versionNumber: number | null;
};
