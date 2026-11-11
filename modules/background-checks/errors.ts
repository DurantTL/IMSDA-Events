/**
 * Sterling Volunteers request errors a route turns into a clear status instead
 * of a 500 (#527). Messages are operator-facing text written here, never
 * record data.
 */
export type BackgroundCheckOperationErrorCode =
  | "PREVIEW_CHANGED"
  | "REVIEW_NOT_FOUND"
  | "NOT_A_CANDIDATE"
  | "MATCH_NOT_FOUND"
  | "NOT_A_MANUAL_MATCH"
  | "NOT_A_NAME_ONLY_MATCH"
  | "UPLOAD_IN_PROGRESS"
  | "LIST_BUSY"
  | "LIST_CHANGED"
  | "RECENTLY_REMINDED"
  | "REMINDER_EMAIL_NOT_CONFIGURED"
  | "TOO_MANY_PEOPLE"
  | "NOTHING_TO_SEND";

const statusByCode: Record<BackgroundCheckOperationErrorCode, number> = {
  PREVIEW_CHANGED: 409,
  REVIEW_NOT_FOUND: 404,
  NOT_A_CANDIDATE: 400,
  MATCH_NOT_FOUND: 404,
  NOT_A_MANUAL_MATCH: 400,
  NOT_A_NAME_ONLY_MATCH: 400,
  UPLOAD_IN_PROGRESS: 409,
  LIST_BUSY: 409,
  LIST_CHANGED: 409,
  RECENTLY_REMINDED: 409,
  REMINDER_EMAIL_NOT_CONFIGURED: 503,
  TOO_MANY_PEOPLE: 400,
  NOTHING_TO_SEND: 400,
};

export class BackgroundCheckOperationError extends Error {
  readonly status: number;

  /** `details` is for the page (for example the people reminded recently): ids, names and dates, never an address. */
  constructor(readonly code: BackgroundCheckOperationErrorCode, message: string, readonly details?: unknown) {
    super(message);
    this.name = "BackgroundCheckOperationError";
    this.status = statusByCode[code];
  }
}
