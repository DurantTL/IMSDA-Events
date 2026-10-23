export type InformationFormErrorCode =
  | "FORM_NOT_FOUND"
  | "RESPONSE_NOT_FOUND"
  | "EDIT_CONFLICT"
  | "NO_DRAFT"
  | "NOT_PUBLISHED"
  | "FORM_BUSY"
  | "FORM_SLUG_TAKEN"
  | "TEMPLATE_NOT_FOUND"
  | "INVALID_DEFINITION"
  | "INVALID_REQUEST"
  | "FORM_NOT_OPEN"
  | "SIGN_IN_REQUIRED"
  | "ANSWERS_INVALID"
  | "EXPORT_TOO_LARGE";

const statusByCode: Record<InformationFormErrorCode, number> = {
  FORM_NOT_FOUND: 404,
  RESPONSE_NOT_FOUND: 404,
  TEMPLATE_NOT_FOUND: 404,
  EDIT_CONFLICT: 409,
  NO_DRAFT: 409,
  NOT_PUBLISHED: 409,
  FORM_BUSY: 409,
  FORM_SLUG_TAKEN: 409,
  FORM_NOT_OPEN: 409,
  INVALID_DEFINITION: 400,
  INVALID_REQUEST: 400,
  ANSWERS_INVALID: 400,
  EXPORT_TOO_LARGE: 413,
  SIGN_IN_REQUIRED: 401,
};

export class InformationFormError extends Error {
  readonly status: number;

  constructor(
    public readonly code: InformationFormErrorCode,
    message: string,
    public readonly issues?: ReadonlyArray<{ key?: string; message: string }>,
  ) {
    super(message);
    this.name = "InformationFormError";
    this.status = statusByCode[code];
  }
}
