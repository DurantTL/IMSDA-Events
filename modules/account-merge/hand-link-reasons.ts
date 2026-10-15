/**
 * The reasons a system administrator can give for hand-linking or unlinking a
 * person's sign-ins (#554 slice c). Pure and client-safe so the dialog and the
 * server share one list and one limit. The audit entry records the code and the
 * optional note; the note must not contain personal details.
 */
export const HAND_LINK_REASON_CODES = ["WRONG_PERSON_LINKED", "DIFFERENT_STAFF_EMAIL", "CORRECTION", "OTHER"] as const;
export type HandLinkReasonCode = (typeof HAND_LINK_REASON_CODES)[number];

export const HAND_LINK_REASON_LABELS: Record<HandLinkReasonCode, string> = {
  WRONG_PERSON_LINKED: "Wrong person was linked",
  DIFFERENT_STAFF_EMAIL: "Different staff email",
  CORRECTION: "Correction",
  OTHER: "Other (add a note)",
};

/** A note is optional, except for "Other" where it is 5 to 500 characters. */
export const HAND_LINK_NOTE_MIN_FOR_OTHER = 5;
export const HAND_LINK_NOTE_MAX = 500;
