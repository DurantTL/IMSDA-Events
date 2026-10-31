/**
 * Names a form copied for a NEW event after that event (#1406), so a form made from last year's template does not
 * carry last year's name into the title, the web address or the confirmation. Pure and client-safe. Used only when an
 * event is created from an event template; existing forms are never renamed.
 */

/** The registration form definition's title limit (`registrationFormDefinitionSchema`). */
export const FORM_TITLE_MAX_LENGTH = 120;
/** The definition's confirmation message limit. */
const CONFIRMATION_MAX_LENGTH = 500;

const TITLE_SUFFIX = " registration";

/** `<event name> registration`, with the name shortened so the title stays within the 120-character limit. */
export function eventRegistrationFormTitle(eventName: string): string {
  const name = eventName.trim().slice(0, FORM_TITLE_MAX_LENGTH - TITLE_SUFFIX.length).trim();
  return `${name}${TITLE_SUFFIX}`;
}

/**
 * "Your <phrase> registration has been received" becomes "Your <event name> registration has been received"; the rest
 * of the message is unchanged. A message with no phrase ("Your registration has been received.") is returned as it was,
 * and so is one the new name would push past the message limit.
 */
export function confirmationMessageForEvent(message: string, eventName: string): string {
  const name = eventName.trim();
  const next = message.replace(
    /\b(Your )[^.!?\n]+?( registration has been received)/,
    (_match, start: string, end: string) => `${start}${name}${end}`,
  );
  return next.length > CONFIRMATION_MAX_LENGTH ? message : next;
}

/** A title that names a registration form ("Women’s Retreat 2026 registration"), as opposed to a sign-up or survey. */
export function isRegistrationFormTitle(title: string): boolean {
  return /registration\s*$/i.test(title.trim());
}

/**
 * Which of the forms copied for a new event takes the event's name: the one whose template title ends in
 * "registration", when exactly one does. With none or several, no form is renamed, so a "Volunteer sign-up" never
 * becomes "<event> registration". Returns the index in `titles`, or null.
 */
export function formIndexToNameAfterEvent(titles: readonly string[]): number | null {
  const matches = titles.flatMap((title, index) => (isRegistrationFormTitle(title) ? [index] : []));
  return matches.length === 1 ? matches[0]! : null;
}

/**
 * A copy of a form definition for a new event: the event-specific confirmation text always carries the event's name;
 * the title only when `renameTitle` (the form chosen by `formIndexToNameAfterEvent`).
 */
export function renameFormDefinitionForEvent<T extends { title: string; confirmationMessage: string }>(definition: T, eventName: string, renameTitle = true): T {
  return {
    ...definition,
    title: renameTitle ? eventRegistrationFormTitle(eventName) : definition.title,
    confirmationMessage: confirmationMessageForEvent(definition.confirmationMessage, eventName),
  };
}
