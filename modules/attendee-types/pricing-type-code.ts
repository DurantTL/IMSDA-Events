import type { RegistrationFormDefinition } from "@/modules/forms/definition";
import { attendeeTypeSelector } from "@/modules/attendee-types/form-options";
import { matchLegacyAttendeeTypeAnswer } from "@/modules/attendee-types/legacy-answer";

/**
 * The `EventAttendeeType.code` an attendee will be saved with, worked out the same way the submission does it (the form's
 * attendee-type selector, else the older "Adult, Teen or Child" answer on a general event), so a price rule that depends on
 * the attendee's type (a promo code restricted to attendee types, #102) agrees with what ends up on the attendee row.
 * `types` are the event's configured types the submission may choose from. Returns null when the attendee has no type: a
 * typed rule never matches them.
 */
export function pricingAttendeeTypeCode(input: {
  definition: RegistrationFormDefinition;
  registrationResponses: Record<string, unknown>;
  attendeeResponses: Record<string, unknown>;
  types: ReadonlyArray<{ code: string; label: string }>;
  /** The older single-answer match is allowed: a general event whose attendees are not club or group members. */
  legacyAnswerAllowed: boolean;
}): string | null {
  const merged = { ...input.registrationResponses, ...input.attendeeResponses };
  const selector = attendeeTypeSelector(input.definition);
  if (selector) {
    const selected = String(merged[selector.key] ?? "");
    return selected ? input.types.find((type) => type.code === selected)?.code ?? null : null;
  }
  if (!input.legacyAnswerAllowed) return null;
  return matchLegacyAttendeeTypeAnswer(merged, input.types)?.code ?? null;
}
