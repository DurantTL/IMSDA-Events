/**
 * Imported registrations get a `PublicRegistrationSubmission` row too, keyed with this prefix and stamped with the
 * import time, so readers that count public form submissions can leave them out (#1375).
 */
export const IMPORTED_SUBMISSION_KEY_PREFIX = "wr26-import:";
