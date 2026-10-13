export type MealErrorCode =
  | "EVENT_NOT_FOUND"
  | "SERVICE_NOT_FOUND"
  | "PLAN_NOT_FOUND"
  | "PRICE_NOT_FOUND"
  | "SELECTION_NOT_FOUND"
  | "REGISTRATION_NOT_FOUND"
  | "ATTENDEE_NOT_FOUND"
  | "ATTENDEE_TYPE_NOT_FOUND"
  | "DUPLICATE"
  | "INVALID"
  | "SERVICE_CANCELLED"
  | "DONATION_ONLY"
  | "PLAN_INACTIVE"
  | "NO_TICKET_PLAN"
  | "NOT_COVERED"
  | "PRICE_MISSING"
  | "CAPACITY_FULL"
  | "FROM_FORM"
  | "ALREADY_CANCELLED"
  | "REGISTRATION_NOT_ADJUSTABLE"
  | "TOTAL_BELOW_ZERO"
  | "TOTAL_BELOW_PAID"
  | "REQUEST_REUSED"
  | "CONFLICT";

export class MealError extends Error {
  constructor(public readonly code: MealErrorCode, message: string) {
    super(message);
    this.name = "MealError";
  }
}

export function mealErrorStatus(code: MealErrorCode) {
  switch (code) {
    case "EVENT_NOT_FOUND":
    case "SERVICE_NOT_FOUND":
    case "PLAN_NOT_FOUND":
    case "PRICE_NOT_FOUND":
    case "SELECTION_NOT_FOUND":
    case "REGISTRATION_NOT_FOUND":
    case "ATTENDEE_NOT_FOUND":
    case "ATTENDEE_TYPE_NOT_FOUND":
      return 404;
    case "INVALID":
      return 400;
    case "NOT_COVERED":
    case "PRICE_MISSING":
    case "NO_TICKET_PLAN":
    case "DONATION_ONLY":
      return 422;
    default:
      return 409;
  }
}
