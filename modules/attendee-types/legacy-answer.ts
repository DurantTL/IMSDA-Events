/**
 * Links the older `attendee_type` radio answer (Adult, Teen, Child) to an event's configured attendee type when the form has
 * no attendee-type selector of its own. The match is exact on the label or the code, ignoring case and surrounding spaces.
 * Nothing is guessed: no match, a blank answer or an ambiguous match returns null, and the attendee stays untyped (their age
 * stays unknown, which fails closed for messaging). Age class still comes only from the matched type's age range
 * (ADR 0005 Addendum A), never from the answer itself.
 */
export const LEGACY_ATTENDEE_TYPE_ANSWER_KEY = "attendee_type";

export function matchLegacyAttendeeTypeAnswer<T extends { code: string; label: string }>(
  responses: Record<string, unknown>,
  types: readonly T[],
): T | null {
  const answer = responses[LEGACY_ATTENDEE_TYPE_ANSWER_KEY];
  if (typeof answer !== "string") return null;
  const wanted = answer.trim().toLowerCase();
  if (!wanted) return null;
  const matches = types.filter((type) => type.label.trim().toLowerCase() === wanted || type.code.trim().toLowerCase() === wanted);
  return matches.length === 1 ? matches[0]! : null;
}
