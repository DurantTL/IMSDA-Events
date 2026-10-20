/**
 * The limits and keys of registration form notifications (#1081), in a file with no imports so the settings panel (a
 * client component) can read them without pulling in server code.
 */

/** Owner decision (Caleb, Oct 20, 2026): 10 notifications per form, 10 addresses each. */
export const FORM_NOTIFICATIONS_MAX_PER_FORM = 10;
export const FORM_NOTIFICATION_MAX_RECIPIENTS = 10;

/** The condition key for the registration's location: its value is an event location id. */
export const LOCATION_CONDITION_KEY = "__location";

/** The condition key for the registration's club (#1097): its value is a club organization id. */
export const CLUB_CONDITION_KEY = "__club";

export const notificationConditionOperators = ["EQUALS", "NOT_EQUALS"] as const;
