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

/** A copy of a form definition named after the new event: its title and event-specific confirmation text. */
export function renameFormDefinitionForEvent<T extends { title: string; confirmationMessage: string }>(definition: T, eventName: string): T {
  return {
    ...definition,
    title: eventRegistrationFormTitle(eventName),
    confirmationMessage: confirmationMessageForEvent(definition.confirmationMessage, eventName),
  };
}
