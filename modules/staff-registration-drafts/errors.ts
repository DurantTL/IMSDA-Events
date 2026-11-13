export type StaffDraftErrorCode =
  | "DRAFT_NOT_FOUND"
  | "FORM_NOT_FOUND"
  | "FORM_NOT_AVAILABLE"
  | "CLUB_EVENT"
  | "DRAFT_NOT_EDITABLE"
  | "FORM_CHANGED"
  | "EMAIL_REQUIRED"
  | "REGISTRATION_NOT_OPEN"
  | "EMAIL_NOT_CONFIGURED";

const statusByCode: Record<StaffDraftErrorCode, number> = {
  DRAFT_NOT_FOUND: 404,
  FORM_NOT_FOUND: 404,
  FORM_NOT_AVAILABLE: 409,
  CLUB_EVENT: 409,
  DRAFT_NOT_EDITABLE: 409,
  FORM_CHANGED: 409,
  EMAIL_REQUIRED: 422,
  REGISTRATION_NOT_OPEN: 409,
  EMAIL_NOT_CONFIGURED: 503,
};

export class StaffDraftError extends Error {
  constructor(public readonly code: StaffDraftErrorCode, message: string) {
    super(message);
    this.name = "StaffDraftError";
  }

  get status() {
    return statusByCode[this.code];
  }
}
