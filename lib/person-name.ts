/**
 * The one way a person's name is written for display or export (#1454, rule 13).
 *
 * "display" is "First Last", used on screen. "sorted" is "Last, First", used only
 * in lists sorted by last name and in exports where that order is the point.
 * Either part may be missing; the result never has a stray space or comma.
 * Client-safe: no imports.
 */
export type PersonNameParts = {
  firstName?: string | null;
  lastName?: string | null;
};

export type PersonNameForm = "display" | "sorted";

export function formatPersonName(person: PersonNameParts, form: PersonNameForm = "display"): string {
  const first = (person.firstName ?? "").trim();
  const last = (person.lastName ?? "").trim();

  if (!first || !last) {
    return first || last;
  }

  return form === "sorted" ? `${last}, ${first}` : `${first} ${last}`;
}
